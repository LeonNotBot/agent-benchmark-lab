from __future__ import annotations
import argparse, json, zipfile
from pathlib import Path

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("base_run")
    args=ap.parse_args()
    base=Path(args.base_run).expanduser().resolve()
    marker=json.loads((base/"timeout_sensitivity_2x_latest.json").read_text(encoding="utf-8-sig"))
    exp=Path(marker["experiment_run_dir"])
    out=base.parent/(base.name+"_timeout_sensitivity_2x_report.zip")
    files=[
        (base/"results.infra_adjusted.json","baseline/results.final.json"),
        (base/"run_config.json","baseline/run_config.json"),
        (base/"timeout_sensitivity_2x_latest.json","experiment/marker.json"),
        (exp/"results.json","experiment/results.json"),
        (exp/"results.csv","experiment/results.csv"),
        (exp/"run_config.json","experiment/run_config.json"),
        (base/"results.timeout_sensitivity_2x.json","merged/results.timeout_sensitivity_2x.json"),
        (base/"results.timeout_sensitivity_2x.csv","merged/results.timeout_sensitivity_2x.csv"),
        (base/"summary.timeout_sensitivity_2x.txt","merged/summary.timeout_sensitivity_2x.txt"),
    ]
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
        for src,arc in files:
            if src.exists(): z.write(src,arc)
        troot=exp/"transcripts"
        if troot.exists():
            for p in troot.rglob("*"):
                if p.is_file():
                    z.write(p,"experiment/transcripts/"+str(p.relative_to(troot)).replace("\\","/"))
    print(out)
    print(f"SizeMB={out.stat().st_size/1024/1024:.2f}")
if __name__=="__main__":
    main()
