from pathlib import Path
import sys,datetime
root=Path('/Users/jaumepuig/Documents/growth-hackathon')
entry='\n- '+datetime.datetime.now(datetime.timezone.utc).isoformat()+': '+' '.join(sys.argv[1:])+'\n'
for p in [root/'.orch/progress/v14-test.md',root/'dev/v14-test/PROGRESS.md']:
 p.write_text(p.read_text()+entry)
