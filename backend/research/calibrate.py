# Checks how honest the confidence % is (run from backend/: python research/calibrate.py). Needs the feature cache from train.py.
import sys
from pathlib import Path
sys.path.insert(0,'.')
from pathlib import Path
from collections import Counter
import numpy as np, pandas as pd
from sklearn.model_selection import KFold
from sklearn.covariance import LedoitWolf
from train import image_dirs, list_images, build_table, featurize, pool_by_sample
from soilsight.constants import TARGET_COLUMNS
from soilsight.model import SoilModel
from soilsight.soil import apply_constraints, soil_type, soil_group, coarse_or_fine
root=Path(sys.argv[1] if len(sys.argv) > 1 else '../data'); lab=pd.read_csv(root/'Training_labels_updated.csv')
ids=lab.sample_id.astype(str).tolist(); t,_=build_table(list_images(image_dirs(root,'Training')),ids,None)
F=featurize(t,None,Path('artifacts/cache')); X,ids2=pool_by_sample(t,F,ids)
Y=lab.set_index('sample_id').loc[ids2,TARGET_COLUMNS].to_numpy(float)
cases=[]   # (pred curve, mu, cov, true)
for seed in range(5):
  for tr,va in KFold(5,shuffle=True,random_state=seed).split(X):
    inner=np.zeros_like(Y[tr])
    for a,b in KFold(5,shuffle=True,random_state=1).split(tr):
        f=SoilModel._fit_fold(X[tr][a],Y[tr][a]); inner[b]=apply_constraints(SoilModel._fold_predict(f,X[tr][b])[0])
    res=Y[tr]-inner; mu=res.mean(0)[:-1]; cov=LedoitWolf().fit(res[:,:-1]).covariance_
    f=SoilModel._fit_fold(X[tr],Y[tr]); P=apply_constraints(SoilModel._fold_predict(f,X[va])[0])
    for i,p in zip(va,P): cases.append((p,mu,cov,Y[i]))
rng=np.random.default_rng(0)
Z=rng.standard_normal((1000,10))
for K in (1.0,1.25,1.5,1.75,2.0,2.5):
    out={'group':[], 'coarse':[], 'detail':[]}
    for p,mu,cov,y in cases:
        L=np.linalg.cholesky(cov+1e-6*np.eye(10))
        d=np.repeat(p[None],1000,0); d[:,:-1]+=mu+K*(Z@L.T); d=apply_constraints(d)
        for k,fn in (('group',soil_group),('coarse',coarse_or_fine),('detail',soil_type)):
            cnt=Counter(fn(x) for x in d); top,n=cnt.most_common(1)[0]; out[k].append((n/1000, top==fn(y)))
    line=f'K={K}: '
    for k,v in out.items():
        v=np.array(v); c,ok=v[:,0],v[:,1].astype(bool); hi=c>=0.8
        line+=f'{k}: conf {c.mean()*100:.0f}% vs right {ok.mean()*100:.0f}% | >=80%: {hi.mean()*100:.0f}% of samples, right {ok[hi].mean()*100 if hi.any() else 0:.0f}%   '
    print(line, flush=True)
