import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadCreatureRig, retargetCreatureClips } from './creatures.js';

const PHASES = [0, .25, .5, .75, 1];
const TOLERANCE = 1e-4;

function collectBones(root) {
  const result = new Map();
  root.traverse(object => {
    if (!object.isBone) return;
    if (result.has(object.name)) throw new Error(`Retarget check: duplicate bone ${object.name}`);
    result.set(object.name, object);
  });
  return result;
}

function actorFrame(actor) {
  actor.updateMatrixWorld(true);
  return {
    inverseMatrix: actor.matrixWorld.clone().invert(),
    inverseRotation: actor.getWorldQuaternion(new THREE.Quaternion()).invert(),
  };
}

function inActorFrame(bone, frame) {
  return {
    position: bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(frame.inverseMatrix),
    rotation: bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(frame.inverseRotation).normalize(),
  };
}

function sampleClip(mixer, root, clip, phase) {
  // No crossfade or concurrent action may mask a conversion error.
  mixer.stopAllAction();
  const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(phase * clip.duration);
  root.updateMatrixWorld(true);
}

/**
 * Independent skeletal equivalence check, with no renderer or generated game mesh.
 * The target has identity local quaternions and the source's rest joint positions.
 * Compare positions and world rotation deltas in each actor's own common frame.
 * Error units: metres for position; radians for rotation. Throws on a failed sample.
 */
export async function checkRetargetBases(type) {
  const source = await loadCreatureRig(type);
  const reference = clone(source.scene);
  const referenceActor = new THREE.Group();
  referenceActor.name = `${type}_retarget_reference_actor`;
  referenceActor.add(reference);
  const sourceBones = collectBones(reference);
  const expected = source.metadata.bones;
  if (sourceBones.size !== expected.length || expected.some(name => !sourceBones.has(name))) {
    throw new Error(`${type} retarget check: source bone names do not match metadata`);
  }
  const sourceRestFrame = actorFrame(referenceActor);
  const rest = new Map([...sourceBones].map(([name, bone]) => [name, inActorFrame(bone, sourceRestFrame)]));

  const targetActor = new THREE.Group();
  targetActor.name = `${type}_identity_basis_actor`;
  const targetBones = new Map([...sourceBones.keys()].map(name => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.quaternion.identity();
    return [name, bone];
  }));
  for (const [name, sourceBone] of sourceBones) {
    const bone = targetBones.get(name);
    bone.position.copy(rest.get(name).position);
    if (sourceBone.parent?.isBone) {
      const parentName = sourceBone.parent.name;
      targetBones.get(parentName).add(bone);
      // All target rest rotations are identity, so local offsets are world differences.
      bone.position.sub(rest.get(parentName).position);
    } else {
      targetActor.add(bone);
    }
  }
  const identity = new THREE.Quaternion();
  const changedRestBases = [...rest.values()].filter(pose => pose.rotation.angleTo(identity) > TOLERANCE).length;
  if (!changedRestBases) throw new Error(`${type} retarget check: identity-basis target does not differ from source`);

  const report = {
    type, pass: false, count: 0, maxPositionError: 0, maxRotationError: 0,
    tolerance: TOLERANCE, bones: sourceBones.size, clips: source.animations.length,
    changedRestBases, phases: PHASES.slice(), cases: [],
    coverage: 'Synthetic skeleton with identity local rest quaternions; no game mesh or skin-weight validation.',
  };
  const sourceMixer = new THREE.AnimationMixer(referenceActor);
  let targetMixer = null;
  try {
    for (const rotated of [false, true]) {
      sourceMixer.stopAllAction();
      if (targetMixer) {
        targetMixer.stopAllAction();
        targetMixer.uncacheRoot(targetActor);
      }
      for (const bone of targetBones.values()) bone.quaternion.identity();
      referenceActor.position.set(0, 0, 0);
      referenceActor.rotation.set(0, 0, 0);
      targetActor.position.set(0, 0, 0);
      targetActor.rotation.set(0, 0, 0);
      if (rotated) {
        // Different transforms on both actors ensure the comparison uses actor frames.
        referenceActor.position.set(-1.3, .7, 2.1);
        referenceActor.rotation.set(-.17, .31, -.23);
        targetActor.position.set(2.7, -1.1, .4);
        targetActor.rotation.set(.29, -.67, .43);
      }
      actorFrame(referenceActor);
      const targetRestFrame = actorFrame(targetActor);
      const targetRest = new Map([...targetBones].map(([name, bone]) => [name, inActorFrame(bone, targetRestFrame)]));
      for (const [name, pose] of targetRest) {
        const error = pose.position.distanceTo(rest.get(name).position);
        if (error > TOLERANCE || pose.rotation.angleTo(identity) > TOLERANCE) {
          throw new Error(`${type} retarget check: synthetic target rest construction failed for ${name}, position error ${error}`);
        }
      }

      const converted = await retargetCreatureClips(type, targetActor);
      const clips = new Map(converted.map(clip => [clip.name, clip]));
      targetMixer = new THREE.AnimationMixer(targetActor);
      const result = { name: rotated ? 'different_actor_transforms' : 'identity_actor_transforms', count: 0, maxPositionError: 0, maxRotationError: 0 };
      for (const sourceClip of source.animations) {
        const targetClip = clips.get(sourceClip.name);
        if (!targetClip || Math.abs(targetClip.duration - sourceClip.duration) > 1e-6) {
          throw new Error(`${type} retarget check: missing or changed duration for ${sourceClip.name}`);
        }
        for (const phase of PHASES) {
          sampleClip(sourceMixer, referenceActor, sourceClip, phase);
          sampleClip(targetMixer, targetActor, targetClip, phase);
          const sourceFrame = actorFrame(referenceActor);
          const targetFrame = actorFrame(targetActor);
          for (const [name, sourceBone] of sourceBones) {
            const actualSource = inActorFrame(sourceBone, sourceFrame);
            const actualTarget = inActorFrame(targetBones.get(name), targetFrame);
            const positionError = actualSource.position.distanceTo(actualTarget.position);
            // Rotation delta is world-animated * inverse(world-rest), in actor space.
            const sourceDelta = actualSource.rotation.multiply(rest.get(name).rotation.clone().invert()).normalize();
            const targetDelta = actualTarget.rotation.multiply(targetRest.get(name).rotation.clone().invert()).normalize();
            const rotationError = sourceDelta.angleTo(targetDelta);
            if (!Number.isFinite(positionError) || !Number.isFinite(rotationError) || positionError > TOLERANCE || rotationError > TOLERANCE) {
              throw new Error(`${type} retarget mismatch: ${result.name}, clip=${sourceClip.name}, phase=${phase}, bone=${name}, position=${positionError} m, rotation=${rotationError} rad (limit ${TOLERANCE})`);
            }
            result.count++;
            result.maxPositionError = Math.max(result.maxPositionError, positionError);
            result.maxRotationError = Math.max(result.maxRotationError, rotationError);
          }
        }
      }
      report.count += result.count;
      report.maxPositionError = Math.max(report.maxPositionError, result.maxPositionError);
      report.maxRotationError = Math.max(report.maxRotationError, result.maxRotationError);
      report.cases.push(result);
    }
    report.pass = true;
    return report;
  } finally {
    sourceMixer.stopAllAction();
    sourceMixer.uncacheRoot(referenceActor);
    if (targetMixer) {
      targetMixer.stopAllAction();
      targetMixer.uncacheRoot(targetActor);
    }
    // SkeletonUtils clones skeleton ownership, while geometry/material remain cached.
    const skeletons = new Set();
    reference.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
    skeletons.forEach(skeleton => skeleton.dispose());
  }
}
