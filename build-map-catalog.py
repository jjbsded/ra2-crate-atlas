"""Build a relocatable catalog from official MIX/PKT/CSF, preserving map bytes."""
import argparse
from collections import Counter
import ctypes
import hashlib
import json
from pathlib import Path
import sys
import zipfile

from runtime_bootstrap import ROOT
from realmap_resources import resources, readmix
from realmap_format import ini, number, yes, sha
from realmap_parser import parse_map, LANDS, land_after
from official_maps import MODES, display_name, group_maps

sys.path.insert(0, str(ROOT/'resource_context'))
from ra2mod import parse_csf


def simplified(text):
    if not text:
        return text
    function = ctypes.windll.kernel32.LCMapStringEx
    function.argtypes = [ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_wchar_p,ctypes.c_int,
                        ctypes.c_wchar_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_longlong]
    function.restype = ctypes.c_int
    out = ctypes.create_unicode_buffer(len(text)*2+2)
    if not function('zh-CN',0x02000000,text,len(text),out,len(out),None,None,0):
        raise OSError('无法将官方中文地图名转换为简体')
    return out.value


def crate_fingerprint(cells, meta, rules, map_ini):
    """Compare inputs to the static crate model, including cleared-object risk.

    Preview, lighting, editor headers, AI, unit orders/health and cosmetic TMP
    IDs are irrelevant here. Actual raw bytes for both versions remain bundled.
    """
    costs = {i: [number(rules[name.upper()].get(k,'0')) != 0 for k in ('TRACK','FLOAT','FOOT')]
             for i,name in enumerate(LANDS) if name.upper() in rules}
    names = [rules['CRATERULES'].get('CRATEIMG','CRATE'),rules['CRATERULES'].get('WATERCRATEIMG','WCRATE')]
    fields = ('x','y','level','slope','rawLand','land','postLand','overlayName','overlayData',
              'occupied','usable','track','float','foot','wall','primary','status','rockTransition',
              'bridge','bridgeProjection','occupiedGround','occupiedDeck')
    rows = []
    for c in sorted(cells.values(), key=lambda c:(c['y'],c['x'])):
        remove_mineral = any(o['category']=='mineral' for o in c['removable'])
        overlay = None if remove_mineral else c['overlayName']
        cfg = rules.get(overlay,{}) if overlay else None
        cleared = land_after(c['rawLand'],c['slope'],cfg,c['higher'],meta['cliffBackImpassability'])
        post = land_after(c['rawLand'],c['slope'],rules[names[int(cleared==2)].upper()],
                          c['higher'],meta['cliffBackImpassability'])
        rows.append([*[c[k] for k in fields],overlay,cleared,costs[cleared],post,costs[post]])
    crate_overrides = {section:{k:v for k,v in values.items() if 'CRATE' in k or section=='POWERUPS'}
                       for section,values in map_ini.items()}
    crate_overrides = {k:v for k,v in crate_overrides.items() if v}
    payload = dict(size=meta['size'],visibleRect=meta['visibleRect'],theater=meta['theater'],
                   cliff=meta['cliffBackImpassability'],crateRules=rules['CRATERULES'],
                   crateOverrides=crate_overrides,cells=rows)
    return sha(json.dumps(payload,sort_keys=True,separators=(',',':')).encode())


def build(game, output):
    output.mkdir(parents=True,exist_ok=True)
    scratch = ROOT/'output/official-map-build'
    scratch.mkdir(parents=True,exist_ok=True)
    sources, omitted, evidence = [], [], []
    package = output/'maps.zip.tmp'
    with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for version,suffix,mix_name,language in [('ra2','','MULTI.MIX','language.mix'),('yr','md','multimd.mix','langmd.mix')]:
            maps_raw=(game/mix_name).read_bytes();language_raw=(game/language).read_bytes()
            maps=readmix(mix_data=maps_raw);lang=readmix(mix_data=language_raw)
            res=resources(version)
            pkt=res.get(['local.mix'],'missions.pkt') if version=='ra2' else lang['missionsmd.pkt']
            registry=ini(pkt);csf=lang['ra2'+suffix+'.csf']
            labels={k:simplified(v[0]['strings'][0]['text']) for k,v in parse_csf(csf)['labels'].items()}
            evidence.append(dict(version=version,mapArchive=mix_name,mapArchiveSha256=sha(maps_raw),
                registry='missions'+suffix+'.pkt',registrySha256=sha(pkt),
                names='ra2'+suffix+'.csf',namesSha256=sha(csf),languageArchive=language,
                languageArchiveSha256=sha(language_raw)))
            registered = set()
            for name in registry['MULTIMAPS'].values():
                filename=name.lower()+'.map';registered.add(filename)
                if filename not in maps:
                    omitted.append(dict(version=version,file=filename,reason='官方目录中有记录，但发行地图包不含此文件'))
                    continue
                definition=registry[name.upper()]
                modes=[m.strip().lower() for m in definition['GAMEMODE'].split(',') if m.strip().lower() in MODES]
                if not modes:
                    omitted.append(dict(version=version,file=filename,reason='未发布的游戏模式'))
                    continue
                raw=maps[filename];m=ini(raw);map_info=m['MAP'];fingerprint=None;unsupported=None
                try:
                    cells,_,theater,_,meta=parse_map(raw,scratch,version)
                    fingerprint=crate_fingerprint(cells,meta,theater['effectiveRules'],m)
                except ValueError as error:
                    unsupported=str(error)
                member=version+'/'+filename
                archive.writestr(member,raw)
                sources.append(dict(version=version,file=filename,path=member,archive=mix_name,
                    sha256=sha(raw),name=display_name(labels[definition['DESCRIPTION'].lower()]),
                    nameLabel=definition['DESCRIPTION'],modes=modes,
                    players=[int(definition['MINPLAYERS']),int(definition['MAXPLAYERS'])],
                    size=list(map(int,map_info['SIZE'].split(',')))[2:],theater=map_info['THEATER'].upper(),
                    crateFingerprint=fingerprint,unsupportedReason=unsupported))
            for filename in maps.keys()-registered:
                omitted.append(dict(version=version,file=filename,reason='发行包附带，未列入官方地图选择菜单'))
            print(f'{version}: {sum(s["version"]==version for s in sources)} maps indexed',flush=True)
    entries=group_maps(sources)
    result=dict(schemaVersion=1,comparison='static-crate-inputs-v4-stock-loading',scope='official-multiplayer-menu',
        maps=entries,modes=[dict(id=k,name=v) for k,v in MODES.items()],sources=evidence,omitted=omitted,
        counts=dict(files=len(sources),entries=len(entries),shared=sum(e['shared'] for e in entries),
                    supportedFiles=sum(not s['unsupportedReason'] for s in sources),
                    versions=dict(Counter(s['version'] for s in sources))))
    catalog = output/'catalog.json.tmp'
    catalog.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    package.replace(output/'maps.zip')
    catalog.replace(output/'catalog.json')
    print(json.dumps(result['counts'],ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--game',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'official-maps')
    args=parser.parse_args()
    build(args.game,args.output)
