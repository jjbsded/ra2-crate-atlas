"""Cross-language, bit-exact static transport round-trip against real reports."""
import argparse
import gzip
import json
from pathlib import Path
from toy_codec import columns,compact_report,compact_search,dumps,expand_report,expand_search,probability_recipe,selections,zipped


def fixture(folder, output):
    report=json.loads((folder/'result.json').read_text('utf-8'))
    raw=(folder/'search.bin').read_bytes()
    recipe=probability_recipe(report,selections(raw,report['probability']['sampleCount']))
    table=dict(count=len(report['cells']),columns=columns(report['cells']))
    compact=compact_report(report,recipe,table,'base.json.gz')
    assert expand_report(compact,table)==report
    binary=compact_search(raw,report['probability']['sampleCount'])
    assert expand_search(binary)==raw
    output.mkdir(parents=True,exist_ok=True)
    (output/'original.json').write_bytes(dumps(report))
    (output/'base.json.gz').write_bytes(zipped(table))
    (output/'result.json.gz').write_bytes(zipped(compact))
    (output/'search.bin.gz').write_bytes(gzip.compress(binary,mtime=0))
    (output/'original.bin').write_bytes(raw)
    print(json.dumps(dict(folder=str(folder),cells=len(report['cells']),originalJSON=len(zipped(report)),
                         compactJSON=len(zipped(table))+len(zipped(compact)),originalSearch=len(gzip.compress(raw,mtime=0)),
                         compactSearch=len(gzip.compress(binary,mtime=0)))))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    fixture(args.folder,args.output)
