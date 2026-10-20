"""Write a cpppo.cfg [Identity] file. usage: enip_cfg.py OUTFILE JSON-cip"""
import json, sys
c = json.loads(sys.argv[2])
open(sys.argv[1], "w").write(f"""[Identity]
Vendor Number = {c['vendor']}
Device Type = {c['devtype']}
Product Code Number = {c['pc']}
Product Revision = {c['rev'][0] + 256 * c['rev'][1]}
Status Word = {c['status']}
Serial Number = {c['serial']}
Product Name = {c['name']}
State = 3
""")
