import { HEAD } from './glsl_common.js';

export const FS_VS = /* glsl */`
precision highp float; in vec3 position; out vec2 vUv; void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;

// ------------------------------------------------------------------ opaque resolve: ambient occlusion + screen-space reflections
export const RESOLVE_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0;
uniform sampler2D uCol,uNrm,uDepth;
uniform float uAOr;
vec3 posAt(vec2 uv,float d){vec4 h=uIVP*vec4(uv*2.-1.,d*2.-1.,1.);return h.xyz/h.w;}
void main(){
  vec4 c=textureLod(uCol,vUv,0.); float d=textureLod(uDepth,vUv,0.).r;
  if(d>=1.){o0=vec4(0.);return;}
  vec4 n4=textureLod(uNrm,vUv,0.); vec3 N=normalize(n4.xyz); float pk=n4.w; float refl=floor(pk)/15.,rough=fract(pk)/.94;
  vec3 P=posAt(vUv,d); vec3 V=normalize(uCam-P); float zc=lin2(d);
  float j=jit(gl_FragCoord.xy);
  // AO, two radii
  float ao=0.; float R=uAOr;
  for(int i=0;i<10;i++){
    float fi=float(i); float a=(fi+j)*2.39996; float u=(fi+.5)/10.; float z=1.-u*.92; float s=sqrt(1.-z*z);
    vec3 dir=vec3(cos(a)*s,sin(a)*s,z); vec3 up=abs(N.y)<.95?vec3(0.,1.,0.):vec3(1.,0.,0.); vec3 T=normalize(cross(up,N)),B=cross(N,T);
    float rad=R*mix(.12,1.,fract(u*7.3+j))*(i<4?.35:1.);
    vec3 q=P+N*R*.03+(T*dir.x+B*dir.y+N*dir.z)*rad;
    vec4 h=uVP*vec4(q,1.); vec2 uv=h.xy/h.w*.5+.5; if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))continue;
    float sd=lin2(textureLod(uDepth,uv,0.).r); float df=h.w-sd; if(df>R*.02&&df<R*2.2)ao+=1.-smoothstep(R*.8,R*2.2,df);
  }
  ao=1.-ao/10.*1.05; ao=sat(ao); ao=mix(ao*ao*.4+ao*.6,1.,c.a*.9);
  vec3 col=c.rgb*ao;
  // reflections
  if(refl>.02){
    float nv=sat(dot(N,V)); float F=.04+.96*pow(1.-nv,5.); F=mix(F,1.,.0)*1.; float str=refl*(F*(1.-rough*.5)+.05*refl);
    vec3 jn=normalize(h33(vec3(gl_FragCoord.xy,mod(uFrame,64.)))-.5);
    vec3 r=reflect(-V,normalize(N+jn*rough*rough*.55));
    if(dot(r,N)<.02)r=normalize(r+N*(.04-dot(r,N)));
    float maxT=min(2.6*mix(.35,1.,sat(zc/8.))+zc*.12,6.); vec3 hit=vec3(-1.); float t=maxT*.004+zc*.0015,last=0.;
    float st=1.;
    for(int i=0;i<28;i++){
      vec3 q=P+r*t; vec4 h=uVP*vec4(q,1.); if(h.w<uNear)break; vec2 uv=h.xy/h.w*.5+.5;
      if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))break;
      float sd=lin2(textureLod(uDepth,uv,0.).r); float df=h.w-sd; float th=max((t-last)*1.6,zc*.004);
      if(df>0.&&df<th){ float a=last,b=t; for(int k=0;k<5;k++){float m=(a+b)*.5;vec4 hm=uVP*vec4(P+r*m,1.);vec2 um=hm.xy/hm.w*.5+.5;float dm=hm.w-lin2(textureLod(uDepth,um,0.).r);if(dm>0.)b=m;else a=m;uv=um;} hit=vec3(uv,1.);break;}
      last=t; t+=maxT*(.006+.0052*float(i))*(.75+.5*j)*.55; if(t>maxT)break;
    }
    vec3 env=envSky(r);
    vec3 rc=env;
    if(hit.z>0.){vec2 e=smoothstep(vec2(0.),vec2(.06),hit.xy)*smoothstep(vec2(1.),vec2(.94),hit.xy);vec3 hc=min(textureLod(uCol,hit.xy,0.).rgb,vec3(30.));rc=mix(env,hc,e.x*e.y);}
    col+=rc*str*ao;
  }
  if(bad3(col))col=vec3(0.); o0=vec4(col,1.);
}`;

// shared ray set-up through the crystal shell (air -> glass -> air/water)
const SHELL = /* glsl */`
uniform mat4 uG2W,uW2G; uniform vec3 uCamW; uniform mat4 uIVPW;
vec2 isph(vec3 o,vec3 d,float r){float b=dot(o,d),c=dot(o,o)-r*r,h=b*b-c;if(h<0.)return vec2(1e9,-1e9);h=sqrt(h);return vec2(-b-h,-b+h);}
float inWater(vec3 p){return uWater.w-dot(p,uWater.xyz);}
// returns 0 miss, 1 ok, 2 total internal reflection in the rim
int enterShell(vec3 o,vec3 d,float ior,out vec3 ro,out vec3 rd,out vec3 nO,out float fres){
  ro=o;rd=d;nO=vec3(0.);fres=0.;
  if(dot(o,o)<RI*RI)return 1;
  vec2 t=isph(o,d,RO); if(t.y<0.||t.x>1e8)return 0;
  vec3 p=o+d*max(t.x,0.); nO=p/RO; float c=sat(dot(-d,nO)); fres=.04+.96*pow(1.-c,5.);
  vec3 g=refract(d,nO,1./ior); if(dot(o,o)<RO*RO)g=d;
  vec2 ti=isph(p,g,RI); if(ti.x>1e8){ro=p;rd=g;return 2;}
  vec3 q=p+g*ti.x; vec3 ni=q/RI; float w=inWater(q)>0.?1.333:1.;
  vec3 r=refract(g,ni,ior/w); if(dot(r,r)<.1){ro=q;rd=reflect(g,ni);return 2;}
  ro=q+r*1e-3;rd=r;return 1;
}
vec3 wfx,wfz;
vec2 w2p(vec3 p){return vec2(dot(p,uWX),dot(p,uWZ));}
`;

// ------------------------------------------------------------------ volumetric weather (half resolution)
export const CLOUD_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0;
uniform sampler2D uDepth; uniform vec3 uWX,uWZ; uniform vec2 uHalf;
` + SHELL + /* glsl */`
vec3 sheet(vec3 p){
  if(uStorm<.3)return vec3(0.); vec3 a=vec3(0.); float k=smoothstep(.3,.9,uStorm);
  for(int i=0;i<3;i++){float fi=float(i);float tt=uTime*(1.1+.37*fi)+fi*5.3;float c=floor(tt),f=fract(tt);vec2 h=h22(vec2(c,fi*7.1));float on=step(.42,h21(vec2(c,fi+3.)));
    vec3 q=vec3((h.x-.5)*9.,5.1+h.y*1.3,(h21(vec2(c*1.7,fi))-.5)*9.); float env=exp(-f*5.)*(.55+.45*step(.5,fract(f*9.+h.x*3.)));
    a+=on*env*vec3(.55,.68,1.)/(dot(p-q,p-q)*.55+.22);}
  return a*k*.5;
}
float funnelR(float h){return .11+.06*h+.04*h*h;}
vec2 funnelAxis(float y){float h=max(y-LAND,0.);return uTor.xz+vec2(sin(y*1.1+uTime*1.3),cos(y*.9+uTime*1.05))*.11*h;}
float n_lit(vec3 p){vec2 ax=p.xz-funnelAxis(p.y);float fr=funnelR(max(p.y-LAND,0.));vec2 d=ax/(fr+.01);return sat(.5+.5*dot(normalize(vec3(d.x,.2,d.y)),normalize(uSunDir+vec3(-.6,.5,.5))));}
float cloudD(vec3 p,float lod,out float tor){
  tor=0.; float r=length(p.xz); float base=mix(5.1,4.25,uStorm)+(textureLod(uN2,p.xz*.045+uTime*.002,0.).r-.5)*1.5, top=mix(7.2,8.7,uStorm);
  float d=0.;
  if(p.y>base-.5&&p.y<top){
    float h=(p.y-base)/(top-base); float a=uSpin*(1.+1.6/(.8+r*.5)); vec2 q=rot(a)*p.xz;
    float arm=.5+.5*sin(atan(q.y,q.x)*2.+log(r+.35)*4.6); float eye=smoothstep(.35,1.3,r);
    float cov=mix(uCover*mix(.35,1.25,smoothstep(.3,.7,textureLod(uN2,p.xz*.035+uTime*.0015,0.).b)),mix(.5,1.05,arm)*eye,smoothstep(.45,.9,uStorm));
    vec3 u=vec3(q.x,p.y*1.15,q.y)*.105+vec3(uTime*.004,-uTime*.002,uTime*.003);
    float n=textureLod(uN3,u,lod).r; float n2=textureLod(uN3,u*3.1+vec3(0.,uTime*.01,0.),lod).g;
    float hb=h+(n-.5)*.5+(n2-.5)*.22; float sh=smoothstep(-.12,.2,hb)*smoothstep(1.,.45,h);
    d=n*.75+n2*.33-(1.-cov*.92)*1.02; d=sat(d*1.9)*sh; d=sat(d-(1.-n2)*.12)*3.4;
  }
  if(uTor.w>.01&&p.y<base+.8&&p.y>LAND-.1){
    float h=p.y-LAND; vec2 ax=funnelAxis(p.y); vec2 q=p.xz-ax; float rr=length(q); float fr=funnelR(h)*(.5+.5*uTor.w); float cut=smoothstep(uTor2.x-.4,uTor2.x+.5,h);
    if(rr<fr*2.6+.5){
      float a=atan(q.y,q.x); float sw=a*2.+uTime*(9./(rr*2.+.35))*.55-h*2.2;
      float n=textureLod(uN3,vec3(cos(sw)*.12+rr*.5,h*.22-uTime*.12,sin(sw)*.12),0.).r; float n2=textureLod(uN3,vec3(cos(sw*2.)*.2,h*.7-uTime*.3,sin(sw*2.)*.2+rr),0.).g;
      float f=smoothstep(fr*1.25,fr*.7,rr+(n-.5)*fr*.9)*(.35+1.1*n2);
      float skirt=smoothstep(.55,0.,h)*smoothstep(fr*3.+.5,fr*.6,rr)*(.3+1.*n)*n2*1.5;
      tor=(f*8.5*cut+skirt*4.5*smoothstep(.2,.7,uTor.w))*uTor.w;
    }
  }
  return d;
}
void main(){
  float dep=textureLod(uDepth,vUv,0.).r;
  vec4 a=uIVP*vec4(vUv*2.-1.,-1.,1.),b=uIVP*vec4(vUv*2.-1.,1.,1.); vec3 pn=a.xyz/a.w,pf=b.xyz/b.w; vec3 dir=normalize(pf-pn);
  vec3 ro,rd,nO;float fr; int k=enterShell(uCam,dir,1.5,ro,rd,nO,fr); if(k!=1){o0=vec4(0.,0.,0.,1.);return;}
  vec2 ti=isph(ro,rd,RI*.998); float t1=ti.y,t0=max(0.,ti.x);
  if(dep<1.){vec4 h=uIVP*vec4(vUv*2.-1.,dep*2.-1.,1.);vec3 P=h.xyz/h.w; t1=min(t1,max(0.,dot(P-ro,rd)));}
  // stop at the sea (flat)
  float dn=dot(rd,uWater.xyz); float w0=inWater(ro); if(w0<0.&&dn<-1e-4){float tw=w0/dn;tw=(uWater.w-dot(ro,uWater.xyz))/dn;if(tw>0.)t1=min(t1,tw);} if(w0>0.&&dn>0.){t0=max(t0,w0/dn);} else if(w0>0.){o0=vec4(0.,0.,0.,1.);return;}
  if(t1<=t0){o0=vec4(0.,0.,0.,1.);return;}
  float j=jit(gl_FragCoord.xy*1.+3.); vec3 acc=vec3(0.); float T=1.; const int NS=40; float L=t1-t0;
  float cosS=dot(rd,uSunDir); float g=.55; float hg=mix((1.-g*g)/pow(1.+g*g-2.*g*cosS,1.5),1.,.45);
  vec3 sunL=uSunCol*hg*.55; float up=smoothstep(.3,.8,uWater.y);
  for(int i=0;i<NS;i++){
    float u=(float(i)+j)/float(NS); float ds=L/float(NS);
    // denser sampling near the camera when zoomed in
    float pw=mix(1.,2.2,sat(1.-uD/10.)); float t=t0+L*pow(u,pw); ds=L*pw*pow(u,pw-1.)/float(NS);
    vec3 p=ro+rd*t; float tor; float lod=0.; float d=cloudD(p,lod,tor);
    float h=p.y-LAND;
    // haze carrying the light volume: neon glow, headlight fog, rain mist
    float haze=(.012+.06*uWet*uNight+.03*uRain)*exp(-max(h,0.)*.9)*step(-.4,h)+.0035; haze*=up;
    vec3 lv=h<3.6?lightVol(p):vec3(0.);
    acc+=T*lv*haze*ds*mix(1.,.42,smoothstep(5.,.8,uD))*.95;
    acc+=T*(uAmbS*vec3(.46,.86,1.35)*.85+sunL*.28)*(.010+.022*(1.-uNight)*(1.-.6*uStorm)+.014*uStorm)*ds*up*smoothstep(-.5,.5,h); if(uStorm>.4)acc+=T*sheet(p)*.0045*ds*up;
    // lightning scatter
    if(uFlash.w>.002){vec3 l=uFlash.xyz-p;acc+=T*uFlashC*uFlash.w*(.008+.10*d)*ds*3./(dot(l,l)+.9);}
    if(d>.002||tor>.002){
      float sg=d*1.15+tor*1.5; float shv=1.;
      if(d>.01){float dd=0.;float tt;for(int q=1;q<4;q++){dd+=cloudD(p+uSunDir*float(q)*.28,1.,tt);}shv=exp(-dd*.42);}
      float powd=1.-exp(-sg*1.5);
      vec3 under=lsl(3,p.xz/20.+.5,0.)*.35*exp(-max(p.y-4.2,0.)*.6)+lsl(2,p.xz/20.+.5,0.)*.12;
      vec3 li=sunL*shv*mix(.6,1.,powd)*1.25+uAmbS*(.5+.5*sat((p.y-4.)/3.))*mix(1.,.42,uStorm)+under;
      vec3 sh_=sheet(p); li+=sh_*(.6+.7*powd)*1.1; if(tor>.002){li=mix(li,(uAmbS*2.5+sunL*.5)*vec3(.78,.72,.64)*(.55+.9*n_lit(p))+lightVol(p)*1.1+sh_*.55,sat(tor/(d+tor)));}
      li+=uFlashC*uFlash.w*2.1/(dot(uFlash.xyz-p,uFlash.xyz-p)+1.1);
      float e=exp(-sg*ds); acc+=T*li*(1.-e); T*=e; if(T<.015)break;
    }
    // distant rain shafts
    if(uRain>.05&&h>0.){float rs=textureLod(uN3,vec3(p.x*.12+uTime*.01,.2,p.z*.12),0.).r;float e=exp(-ds*.05*uRain*smoothstep(.4,.8,rs)*smoothstep(6.5,3.,p.y)*up);acc+=T*(uAmbS*.5+vec3(.01))*(1.-e);T*=e;}
  }
  if(bad3(vec3(T))){T=1.;acc=vec3(0.);} if(bad3(acc))acc=vec3(0.);
  o0=vec4(min(acc,vec3(60.)),T);
}`;

// ------------------------------------------------------------------ the room, the table and the plinth
export const EXTERIOR = /* glsl */`
uniform sampler2D uGlow; uniform vec3 uGlowAvg; uniform mat4 uVPW;
vec3 roomEnv(vec3 d,float blur){
  // dim study at night: tall rain-lit window, warm lamp, distant practicals
  vec3 c=mix(vec3(.012,.010,.011),vec3(.030,.021,.017),smoothstep(-.4,.9,d.y));
  c+=vec3(.05,.026,.012)*exp(-dot(d-normalize(vec3(.75,.2,-.6)),d-normalize(vec3(.75,.2,-.6)))*2.5);
  c+=vec3(.010,.018,.034)*exp(-dot(d-normalize(vec3(-.8,.25,-.35)),d-normalize(vec3(-.8,.25,-.35)))*2.);
  // window, camera left
  vec3 w=normalize(vec3(-.86,.36,.36)); vec3 wu=normalize(cross(vec3(0.,1.,0.),w)),wv=cross(w,wu); float dw=dot(d,w);
  if(dw>.02){vec2 q=vec2(dot(d,wu),dot(d,wv))/dw; float s=.012+blur*.6; vec2 e=smoothstep(vec2(.30,.52)+s,vec2(.30,.52)-s,abs(q)); vec2 mg=abs(fract(q*vec2(3.333,2.885)+.5)-.5); float mull=smoothstep(.0,.04+s,min(mg.x/3.3,mg.y/2.9)-.004+s*.5);
    float sky=.5+.5*q.y; c+=mix(vec3(.45,.62,1.),vec3(.2,.34,.75),sky)*e.x*e.y*mix(mull,1.,sat(blur*2.))*1.15*(1.+2.*uFlash.w*.0);}
  // strip softbox above right
  vec3 k=normalize(vec3(.62,.66,.36)); vec3 ku=normalize(cross(vec3(0.,1.,0.),k)),kv=cross(k,ku); float dk=dot(d,k);
  if(dk>.02){vec2 q=vec2(dot(d,ku),dot(d,kv))/dk; float s=.02+blur*.7; vec2 e=smoothstep(vec2(.16,.42)+s,vec2(.16,.42)-s,abs(q)); c+=vec3(1.,.72,.42)*e.x*e.y*1.5;}
  // rim light behind
  vec3 m=normalize(vec3(.35,.25,-.9)); float dm=max(dot(d,m),0.); c+=vec3(1.,.55,.25)*pow(dm,mix(220.,14.,sat(blur*2.)))*1.6;
  return c;
}
vec3 bokeh(vec3 d){
  vec3 c=vec3(0.); vec2 q=vec2(atan(d.x,-d.z),asin(clamp(d.y,-1.,1.)));
  for(int l=0;l<3;l++){float sc=l==0?5.:l==1?8.:13.;vec2 u=q*sc+float(l)*7.3;vec2 g=floor(u),f=fract(u)-.5;vec2 h=h22(g+float(l)*31.);float a=h21(g*1.7+float(l)*5.);
    if(a>.62){float r=.16+.2*h.x;vec2 o=f-(h-.5)*.5;float di=length(o);float disc=smoothstep(r,r*.9,di)*(.55+.45*smoothstep(r*.3,r,di));vec3 hu=a>.9?vec3(.3,.75,1.):a>.8?vec3(1.,.35,.22):vec3(1.,.66,.32);
      float band=exp(-pow((q.y-.10)*3.2,2.));c+=hu*disc*band*(.05+.22*h.y*h.y)*(l==2?.6:1.);}}
  return c;
}
float sdBox2(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return length(max(d,0.))+min(max(d.x,d.y),0.)-r;}
float baseSDF(vec3 p,out int m){
  float r=length(p.xz); vec2 q=vec2(r,p.y); m=0; float a=atan(p.z,p.x);
  float fl=.05*(.5+.5*cos(a*72.));
  float d=sdBox2(q-vec2(0.,-7.45),vec2(8.0,.72),.16);
  float e=sdBox2(q-vec2(0.,-8.65),vec2(8.5-fl,.5),.05); if(e<d)d=e;
  e=sdBox2(q-vec2(0.,-9.7),vec2(9.15,.5),.18); if(e<d)d=e;
  float g=length(q-vec2(7.72,-6.74))-.24; if(g<d){d=g;m=1;}
  g=length(q-vec2(8.1,-8.2))-.12; if(g<d){d=g;m=1;}
  g=length(q-vec2(8.66,-9.2))-.11; if(g<d){d=g;m=1;}
  d=max(d,-(length(p)-RO-.02));
  return d;
}
float baseMap(vec3 p){int m;return baseSDF(p,m);}
// returns distance along ray in globe space or -1
float traceBase(vec3 o,vec3 d,int steps){
  vec2 bt=vec2(-1e9,1e9); // clip to slab and cylinder
  float y0=-10.3,y1=-6.4; if(abs(d.y)>1e-5){float a=(y0-o.y)/d.y,b=(y1-o.y)/d.y;bt=vec2(min(a,b),max(a,b));}else if(o.y<y0||o.y>y1)return -1.;
  float A=dot(d.xz,d.xz),B=dot(o.xz,d.xz),C=dot(o.xz,o.xz)-9.35*9.35,D=B*B-A*C; if(D<0.)return -1.; D=sqrt(D); bt.x=max(bt.x,(-B-D)/A);bt.y=min(bt.y,(-B+D)/A);
  if(bt.y<max(bt.x,0.))return -1.; float t=max(bt.x,0.); int m;
  for(int i=0;i<steps;i++){float h=baseSDF(o+d*t,m);if(h<.0025*(1.+t*.04))return t;t+=h*.85;if(t>bt.y)return -1.;}
  return -1.;
}
float tableY(){return -10.2;}
vec3 shadeBase(vec3 p,vec3 d){
  int m; float dd=baseSDF(p,m); vec3 n=vec3(0.); for(int i=0;i<4;i++){vec3 k=vec3(float(((i+3)>>1)&1),float((i>>1)&1),float(i&1))*2.-1.;n+=k*baseMap(p+k*.004);} n=normalize(n);
  float ao=0.; for(int i=0;i<2;i++){float h=i==0?.25:.8;ao+=sat(baseMap(p+n*h)/h)*(i==0?.6:.4);}
  vec3 nw=mat3(uG2W)*n,dw=mat3(uG2W)*d; vec3 r=reflect(dw,nw); float nv=sat(dot(-dw,nw));
  float ang=atan(p.z,p.x),r0=length(p.xz); vec3 alb;float rough,metal;
  if(m==1){alb=vec3(.95,.64,.27);metal=1.;rough=.17+.1*textureLod(uN2,vec2(ang*2.,p.y)*1.3,0.).r;}
  else{ float gr=textureLod(uN2,vec2(ang*.6,p.y*.9+.2*sin(ang*3.)),0.).r,gr2=textureLod(uN2,vec2(ang*9.,p.y*.12),0.).g; alb=mix(vec3(.05,.02,.012),vec3(.25,.095,.04),gr*.6+gr2*.5);metal=0.;rough=.22+.12*gr2;
    float sF=abs(fract(ang*24./6.2832)-.5); float inl=0.; if(p.y<-9.36&&p.y>-10.08&&n.y<.5){float y=(p.y+10.08)/.72; float ray=smoothstep(.05,.03,abs(sF-.5*y*.9)-.02);float ring=smoothstep(.03,.0,abs(y-.5)-.44);inl=max(ray,ring);}
    if(p.y<-6.95&&p.y>-8.0&&n.y<.5){float q=abs(fract(ang*40./6.2832)-.5);float y=abs((p.y+7.47)/.42);float z=abs(q*1.15+y*.5-.42);inl=max(inl,(z<.035&&y<1.||abs(y-1.08)<.05)?1.:0.);}
    if(inl>.5){alb=vec3(.95,.64,.27);metal=1.;rough=.25;}
  }
  vec3 F0=mix(vec3(.045),alb,metal); vec3 F=F0+(max(vec3(1.-rough),F0)-F0)*pow(1.-nv,5.);
  vec3 spec=roomEnv(r,rough*.55);
  vec3 toC=normalize(vec3(0.,-2.,0.)-p); float gl=sat(dot(n,toC)*.6+.4); float gd=1./(1.+pow(length(p-vec3(0.,-4.,0.))*.14,2.)); vec3 glow=uGlowAvg*gl*gd*2.2;
  vec3 rg=reflect(d,n); vec2 sp=isph(p,rg,RO); if(sp.y>0.&&sp.x<1e8)spec+=uGlowAvg*1.6*smoothstep(0.,6.,sp.y-max(sp.x,0.));
  vec3 key=normalize(vec3(.62,.66,.36)),key2=normalize(vec3(-.86,.36,.36));
  vec3 c=alb*(1.-metal)*(roomEnv(nw,1.)*1.6+glow+vec3(1.,.72,.42)*max(dot(nw,key),0.)*.22+vec3(.45,.62,1.)*max(dot(nw,key2),0.)*.16)+spec*F*1.55;
  return c*ao;
}
// primary ray, then (off the lacquered table) one mirror bounce, sharing a single trace and shade
vec3 exterior(vec3 o,vec3 d,out float dist){
  dist=200.; vec3 acc=vec3(0.),thr=vec3(1.);
  for(int i=0;i<2;i++){
    vec3 lo=(uW2G*vec4(o,1.)).xyz,ld=mat3(uW2G)*d; float tt=(i==0&&d.y<-1e-4)?(tableY()-o.y)/d.y:-1.; float tb=traceBase(lo,ld,i==0?56:34);
    if(tb>0.&&(tt<0.||tb<tt)){if(i==0)dist=tb;acc+=thr*shadeBase(lo+ld*tb,ld);break;}
    if(i==1){ vec2 sg=isph(lo,ld,RO); vec3 e;
      if(sg.y>0.&&sg.x<1e8){vec3 h=lo+ld*max(sg.x,0.);vec3 hw=(uG2W*vec4(h,1.)).xyz;vec4 sp=uVPW*vec4(hw,1.);vec2 uv=sp.xy/sp.w*.5+.5;e=textureLod(uGlow,clamp(uv,.02,.98),0.).rgb*.9+roomEnv(reflect(d,mat3(uG2W)*(h/RO)),.1)*.35;}
      else e=roomEnv(d,.12)+bokeh(d)*.5;
      acc+=thr*e;break;}
    vec3 bg=roomEnv(d,.5)*.36+bokeh(d)*.8;
    if(tt<=0.){acc+=bg;break;}
    vec3 p=o+d*tt;dist=tt;float far=length(p.xz); if(far>140.){acc+=bg;break;}
    // dark walnut top with a deep lacquer coat
    vec2 q=p.xz; float g=textureLod(uN2,vec2(q.x*.012,q.y*.11)+textureLod(uN2,q*.01,0.).r*.04,0.).r,g2=textureLod(uN2,vec2(q.x*.05,q.y*.9),0.).g;
    vec3 alb=mix(vec3(.045,.019,.011),vec3(.17,.072,.032),g*.75+g2*.35);
    float dc=length(q-vec2(uG2W[3].x,uG2W[3].z)); float lift=max(0.,uG2W[3].y);
    float con=mix(smoothstep(8.4,13.,dc),1.,sat(lift*.12)); con=mix(con,smoothstep(2.,20.,dc)*.5+.5,sat(lift*.06)*.6);
    vec3 n=normalize(vec3((g2-.5)*.012,1.,(g-.5)*.012)); vec3 r=reflect(d,n); float F=.035+.965*pow(1.-sat(dot(-d,n)),5.);
    vec3 glow=uGlowAvg*(5.5/(1.+pow(max(dc-9.,0.)*.21,2.)))*.55; float cau=.75+.5*textureLod(uN2,q*.06+uTime*.006,0.).r; glow*=mix(1.,cau,.5);
    float pool=exp(-dot(q-vec2(7.,5.),q-vec2(7.,5.))*.0024); vec3 c=alb*(roomEnv(vec3(0.,1.,0.),1.)*1.3+glow+vec3(1.,.68,.38)*.20*pool+vec3(.4,.55,.9)*.05*exp(-dot(q+vec2(16.,-4.),q+vec2(16.,-4.))*.002))*con;
    float fade=smoothstep(30.,120.,far); acc+=mix(c,bg,fade); thr=vec3(F*mix(.35,1.,con)*1.9)*(1.-fade); o=p+n*.01; d=r;
  }
  return acc;
}
`;

// ------------------------------------------------------------------ final composite: glass, ocean, refraction
export const COMP_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler2D uOpq,uDepth,uClouds,uFx,uNrm; uniform vec3 uWX,uWZ; uniform float uLens;
` + SHELL + EXTERIOR + /* glsl */`
vec2 proj(vec3 p,out float w){vec4 h=uVP*vec4(p,1.);w=h.w;return h.xy/h.w*.5+.5;}
// iterative screen-space intersection of a (refracted) ray with the opaque scene
float hitOpaque(vec3 ro,vec3 rd,float tMax,float guess,out vec2 uv,out bool ok){
  float t=clamp(guess,0.02,tMax); ok=false; float w; uv=vec2(0.);
  for(int i=0;i<6;i++){vec3 p=ro+rd*t;uv=proj(p,w);if(w<uNear||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){ok=false;return tMax;}
    float d=textureLod(uDepth,uv,0.).r; if(d>=1.){t=tMax;ok=false;p=ro+rd*t;uv=proj(p,w);d=textureLod(uDepth,clamp(uv,0.,1.),0.).r;if(d>=1.)return tMax;}
    float sd=lin2(d); float k=max(dot(rd,uCamF),.25); float dt=(sd-w)/k; t=clamp(t+dt*.9,0.01,tMax); if(abs(dt)<.002*w+.0005)break;}
  uv=proj(ro+rd*t,w); ok=t<tMax-.01; return t;
}
float wH(vec3 p){vec2 q=w2p(p);float sh=1.;if(uWater.y>.9){float th=terr(p.xz).r;sh=mix(.25,1.,smoothstep(0.,.6,uWater.w-th));}
  float h=waveH(q,uWave.z,sh);
  if(uTor.w>.01&&uWater.y>.8){float r=length(p.xz-uTor.xz);h+=uTor.w*(.35*exp(-r*r*5.)-.12*exp(-pow((r-.55)*3.,2.)));}
  return h;}
float wSd(vec3 p){return dot(p,uWater.xyz)-uWater.w-wH(p);}
vec3 wN(vec3 p,float e,float dist){
  float h=wH(p);float hx=wH(p+uWX*e),hz=wH(p+uWZ*e); vec2 g=vec2(hx-h,hz-h)/e;
  vec2 q=w2p(p); float ds=exp(-dist*.045);
  vec2 d1=texture(uN2,q*.55+uWave.z*vec2(.021,.013)).rg-.5,d2=texture(uN2,q.yx*1.7-uWave.z*vec2(.03,.022)).gr-.5,d3=texture(uN2,q*5.3+uWave.z*vec2(.05,-.04)).rg-.5;
  g+=(d1*.32+d2*.26+d3*.22*ds)*(.55+.9*uWave.y*2.+.5*uRain)*.6; return normalize(uWater.xyz-uWX*g.x-uWZ*g.y);
}
vec4 fxAt(vec2 uv){return textureLod(uFx,uv,0.);}
vec3 opq(vec2 uv){return textureLod(uOpq,uv,0.).rgb;}
vec3 ssrWater(vec3 P,vec3 r,vec3 fallback){
  float t=.06,last=0.; float j=jit(gl_FragCoord.xy+7.); vec2 uv;float w;
  for(int i=0;i<26;i++){vec3 q=P+r*t;uv=proj(q,w);if(w<uNear||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))break;
    float sd=lin2(textureLod(uDepth,uv,0.).r);float df=w-sd;float th=max((t-last)*1.8,.04);
    if(df>0.&&df<th){float a=last,b=t;for(int k=0;k<4;k++){float m=(a+b)*.5;float wm;vec2 um=proj(P+r*m,wm);if(wm-lin2(textureLod(uDepth,um,0.).r)>0.)b=m;else a=m;uv=um;}
      vec2 e=smoothstep(vec2(0.),vec2(.05),uv)*smoothstep(vec2(1.),vec2(.95),uv);return mix(fallback,min(opq(uv),vec3(22.)),e.x*e.y);}
    last=t;t+=(.07+.028*float(i))*(.8+.4*j);}
  return fallback;
}
vec3 waterFog(){return (uAmbS*vec3(.06,.42,.5)*.5+uSunCol*max(uSunDir.y,0.)*vec3(.01,.11,.13)*.45+vec3(.0006,.0045,.0075))*(1.-.45*uStorm)+uFlashC*uFlash.w*vec3(.01,.05,.06)*.4;}
vec3 underC(vec3 col,float dist,float depth,vec3 p){
  vec3 ab=exp(-dist*vec3(.40,.115,.085)*mix(1.,1.9,uStorm)); vec3 fog=waterFog()*exp(-depth*.16);
  fog+=lsl(4,p.xz/20.+.5,0.)*vec3(.12,.35,.4)*.22+lsl(0,p.xz/20.+.5,2.)*vec3(.03,.14,.16)*.25;
  return col*ab+fog*(1.-ab);
}
// analytic sea bed, used where a refracted ray leaves the screen
vec3 bedCol(vec3 ro,vec3 rd,float tMax,out float tb,out bool hit){
  hit=false; tb=tMax; float pt=0.,pv=1.; const int N=18; if(uWater.y<.6)return vec3(0.);
  for(int i=1;i<=N;i++){float t=tMax*pow(float(i)/float(N),1.6);vec3 p=ro+rd*t;float v=p.y-terr(p.xz).r;if(v<0.){float a=pt,b=t;for(int k=0;k<5;k++){float m=(a+b)*.5;vec3 q=ro+rd*m;if(q.y-terr(q.xz).r<0.)b=m;else a=m;}tb=b;hit=true;break;}pt=t;pv=v;}
  if(!hit)return vec3(0.); vec3 p=ro+rd*tb; float e=.06; vec3 n=normalize(vec3(terr(p.xz-vec2(e,0.)).r-terr(p.xz+vec2(e,0.)).r,2.*e,terr(p.xz-vec2(0.,e)).r-terr(p.xz+vec2(0.,e)).r));
  float n1=textureLod(uN2,p.xz*.7,0.).r,n2=textureLod(uN2,p.xz*4.3,0.).g; float d=terr(p.xz).g; vec3 alb=d>0.?vec3(.5,.44,.31)*(.8+.3*n2):mix(vec3(.55,.5,.38),vec3(.16,.3,.27),smoothstep(.35,.7,n1))*(.5+.6*n2);
  float dp=max(inWater(p),0.); vec3 amb=uAmbS*exp(-dp*.32)*vec3(.35,.85,1.)+vec3(.010,.05,.066)*(1.-exp(-dp*.32)); return alb*(amb+uSunCol*max(dot(n,uSunDir),0.)*exp(-dp*vec3(.75,.22,.14))+lightVol(p+n*.085));
}
float godray(vec3 p){vec2 q=w2p(p-uSunDir*(-inWater(p)*-1.)/max(uSunDir.y,.2));float n=textureLod(uN2,q*.16+uTime*.012,0.).r*textureLod(uN2,q*.27-uTime*.017,0.).g;return smoothstep(.16,.42,n);}
// full interior radiance along a ray that has already been bent by the shell
vec3 interior(vec3 ro,vec3 rd,float guess,vec2 scr,out float dist,out vec2 huv,out bool exits,out vec3 exP,out vec3 exD,out float trans){
  exits=false;exP=ro;exD=rd;trans=1.; float tExit=max(isph(ro,rd,RI).y,0.); bool ok; vec2 uv; float tO=hitOpaque(ro,rd,tExit,guess,uv,ok); huv=uv; dist=tO;
  float s0=wSd(ro); float amp=uWave.x+uWave.y*.75+uTor.w*.4+.02; float dn=dot(rd,uWater.xyz); float lev=dot(ro,uWater.xyz)-uWater.w;
  float tw=-1.;
  {float ta=0.,tb=tExit; if(abs(dn)>1e-5){float a=(amp-lev)/dn,b=(-amp-lev)/dn;ta=max(0.,min(a,b));tb=min(tExit,max(a,b));}else if(abs(lev)>amp)tb=-1.;
   tb=min(tb,tO+.02);
   if(tb>ta){float pt=ta,st=(tb-ta)/14.; float A=-1.,B=-1.;
     for(int i=0;i<=14;i++){float t=ta+st*float(i);float v=wSd(ro+rd*t);if(v*s0<0.){A=i==0?t:pt;B=t;break;}pt=t;}
     if(B>=0.){for(int k=0;k<4;k++){float m=(A+B)*.5;if(wSd(ro+rd*m)*s0>0.)A=m;else B=m;}tw=(A+B)*.5;}}}
  bool air=s0>=0.; float tEnd=min(tO,tExit); bool surf=tw>=0.&&tw<tEnd;
  vec3 P=ro+rd*max(tw,0.),N=uWater.xyz,r2=rd; float tE2=0.,tB=0.; vec2 uv2=vec2(0.); bool ok2=false,tir=false;
  if(surf){
    N=wN(P,air?.02+tw*.0018:.03,tw);
    if(air){if(dot(N,rd)>-.02)N=normalize(N-rd*(dot(N,rd)+.06));r2=refract(rd,N,1./1.333);}
    else{r2=refract(rd,-N,1.333);if(dot(r2,r2)<.1){tir=true;r2=reflect(rd,-N);}}
    tE2=max(isph(P,r2,RI).y,0.); tB=hitOpaque(P,r2,tE2,air?(ok?max((tO-tw)*.9,.05):tE2):tE2*.5,uv2,ok2);
  }
  float edge=ok2?smoothstep(0.,.06,min(min(uv2.x,1.-uv2.x),min(uv2.y,1.-uv2.y))):0.;
  bool needA=surf&&air&&edge<.99, needW=!air&&!surf&&!ok; vec3 bc=vec3(0.); float tb2=0.; bool hb=false;
  if(needA||needW)bc=bedCol(needA?P:ro,needA?r2:rd,needA?tE2:tExit,tb2,hb);
  vec3 col=vec3(0.);
  if(air){
    if(surf){
      dist=tw; float c=sat(dot(-rd,N)); float F=.02+.98*pow(1.-c,5.);
      vec3 r=reflect(rd,N); if(dot(r,uWater.xyz)<.03)r=normalize(r+uWater.xyz*(.05-dot(r,uWater.xyz)));
      vec3 refl=ssrWater(P+N*.01,r,envSky(r));
      vec3 bb=ok2?opq(uv2):vec3(0.); if(needA){if(!hb)bc=waterFog()*.6;bb=mix(bc,bb,edge);if(!ok2)tB=tb2;} float dp=max(inWater(P+r2*tB),0.);
      vec3 body=underC(bb,tB,dp,P);
      float hgt=wH(P); float cr=sat(hgt/(amp+.001)*.9+.15); body+=(uSunCol*pow(max(dot(rd,uSunDir),0.),4.)*.35+uAmbS*.25)*vec3(.05,.42,.36)*cr*cr*(.3+uWave.y*2.2);
      col=mix(body,refl,F);
      vec3 H=normalize(uSunDir-rd);float nh=max(dot(N,H),0.);float ro2=.05+.12*uWave.y;float a2=ro2*ro2;a2*=a2;float D=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.)+1e-6);col+=uSunCol*min(D*.12*F*8.,18.)*smoothstep(0.,.1,uSunDir.y);
      col+=lightVol(P+vec3(0.,.12,0.)+N*.1)*(.03+.16*F);
      vec2 q=w2p(P); float fn=textureLod(uN2,q*1.1+uWave.z*.02,0.).r,fn2=textureLod(uN2,q*4.1-uWave.z*.03,0.).g; float fo=smoothstep(.55,.95,hgt/(uWave.y*.42+.02)*step(.06,uWave.y)+(fn-.5)*.8)*smoothstep(.06,.25,uWave.y);
      if(uWater.y>.9){float dep=uWater.w+hgt-terr(P.xz).r; float sw=.5+.5*sin(dep*70.-uWave.z*2.2+fn*9.); fo=max(fo,smoothstep(.055,.0,dep)*(.3+.7*sw)*smoothstep(.4,.75,fn+fn2*.4)); fo=max(fo,smoothstep(.60,.80,fn*.7+fn2*.35+uWave.y*.1)*smoothstep(.4,1.,uStorm)*.4);
        if(uTor.w>.01){float rr_=length(P.xz-uTor.xz);fo=max(fo,uTor.w*smoothstep(1.1,.2,rr_+(fn-.5)*.5));}
        fo=max(fo,smoothstep(.05,.0,abs(dep-.02))*.4*uFloodLvl*smoothstep(.4,.6,fn2));}
      fo*=.55+.6*fn2; vec3 fc=(uAmbS*.95+uSunCol*max(uSunDir.y,0.)*.4+lightVol(P+vec3(0.,.1,0.))*.7+uFlashC*uFlash.w*.16)*.8; col=mix(col,fc,sat(fo));
      if(uRain>.02){vec2 rq=q*(uD<3.?26.:9.);vec2 g=floor(rq);float rp=h21(g+floor(uTime*9.+h21(g)*7.)*3.1);vec2 rf=fract(rq)-.5;col+=fc*smoothstep(.82,.99,rp)*smoothstep(.22,.05,length(rf))*uRain*.35;}
    } else if(ok)col=opq(uv);
    else{exits=true;exP=ro+rd*tExit;}
  } else {
    if(surf){dist=tw; float F=1.; vec3 rc=waterFog()*.75+lsl(0,P.xz/20.+.5,1.)*vec3(.06,.2,.22)*.5; vec3 tc=ok2?opq(uv2):envSky(r2)*.8;
      if(!tir){float ct=sat(abs(dot(r2,N)));F=.02+.98*pow(1.-ct,5.);} else rc=mix(rc,tc,.45);
      col=mix(tc*vec3(.75,.95,1.),rc,sat(F)); col+=vec3(.5,.8,.8)*smoothstep(.62,.8,textureLod(uN2,w2p(P)*.9+uWave.z*.03,0.).r)*.02; tEnd=tw;
    } else if(ok)col=opq(uv);
    else if(hb){col=bc;tEnd=tb2;dist=tb2;}
    else{exits=true;exP=ro+rd*tExit;}
    float dM=max(inWater(ro+rd*tEnd*.5),0.);
    vec3 gr=vec3(0.); float sunU=lum(uSunCol)*max(uSunDir.y,0.); if(sunU>.01){for(int i=0;i<5;i++){vec3 q=ro+rd*tEnd*(float(i)+jit(gl_FragCoord.xy))/5.;float dp=max(inWater(q),0.);gr+=godray(q)*exp(-dp*vec3(.6,.2,.16));}gr*=uSunCol*max(uSunDir.y,.0)*tEnd/5.*.035*pow(max(dot(rd,uSunDir)*.5+.5,0.),1.5);}
    if(exits)trans*=lum(exp(-tEnd*vec3(.40,.115,.085)*mix(1.,1.9,uStorm)));
    col=underC(col,tEnd,dM,ro+rd*tEnd*.5)+gr;
  }
  return col;
}
void main(){
  vec4 a=uIVPW*vec4(vUv*2.-1.,-1.,1.),b=uIVPW*vec4(vUv*2.-1.,1.,1.); vec3 pn=a.xyz/a.w,pf=b.xyz/b.w; vec3 dw=normalize(pf-pn);
  vec3 d=normalize(mat3(uW2G)*dw); vec3 col; float dist=200.; float interiorFlag=0.;
  vec3 ro,rd,nO;float fres; bool inside=dot(uCam,uCam)<RI*RI;
  int k=enterShell(uCam,d,1.5,ro,rd,nO,fres);
  // plinth in front of the globe?
  float tg=inside?0.:isph(uCam,d,RO).x; float tb=inside?-1.:traceBase(uCam,d,40);
  int md=(k==0||(tb>0.&&tb<tg))?0:k; vec3 oE=uCamW,dE=dw; float wE=md==0?1.:0.; vec3 ic=vec3(0.); vec2 huv=vUv; float di=0.; float addIn=0.;
  if(md==1){
    float w0=textureLod(uDepth,vUv,0.).r; float guess; if(w0<1.){vec4 h=uIVP*vec4(vUv*2.-1.,w0*2.-1.,1.);guess=dot(h.xyz/h.w-ro,rd);}else guess=1e3;
    bool ex;vec3 exP,exD;float trn; ic=interior(ro,rd,guess,vUv,di,huv,ex,exP,exD,trn); dist=inside?di:di+length(ro-uCam); interiorFlag=1.;
    if(!inside&&fres>.05&&!ex){vec2 off=(huv-vUv)*.06*smoothstep(.05,.5,fres)*1.2+normalize(vUv-.5)*.0012*smoothstep(.05,.4,fres);vec3 cr=opq(clamp(huv+off,0.,1.)),cb=opq(clamp(huv-off,0.,1.)),cg=opq(huv);vec3 rat=vec3(cr.r+.02,1.,cb.b+.02)/vec3(cg.r+.02,1.,cg.b+.02);ic*=mix(vec3(1.),clamp(rat,.4,2.5),.7);}
    if(ex){vec3 nX=normalize(exP); vec3 g=refract(exD,-nX,1./1.5); vec3 q=exP+g*(RO-RI)/max(dot(g,nX),.25); vec3 outd=refract(g,-normalize(q),1.5); if(dot(outd,outd)<.1)outd=exD;
      oE=(uG2W*vec4(normalize(q)*RO*1.001,1.)).xyz;dE=normalize(mat3(uG2W)*outd); float c=sat(abs(dot(exD,nX))); float f2=.04+.96*pow(1.-c,5.); wE=(1.-f2*.8)*trn*.96; ic+=uGlowAvg*.35*f2*.8*trn; if(inside)dist=40.;}
  }
  vec3 ec=vec3(0.); float dd=200.; if(wE>0.)ec=exterior(oE,dE,dd);
  if(md==0){col=ec;dist=dd;}
  else if(md==2){ // rim: light guided round the crystal edge
    vec3 rw=mat3(uG2W)*rd; col=roomEnv(rw,.02)*1.25+roomEnv(reflect(rw,mat3(uG2W)*nO),.05)*.5+bokeh(rw)*.8+uGlowAvg*.7; vec3 rr=reflect(d,nO); col=col*(1.-fres)+roomEnv(mat3(uG2W)*rr,.02)*fres; dist=tg;
    vec2 un=vUv+normalize(nO.xy+1e-4)*-.05; col+=textureLod(uGlow,clamp(un,.01,.99),0.).rgb*.35;
  } else {
    col=ic+ec*wE*vec3(.97,1.,1.);
    // weather, then sprites on top
    vec4 cl=textureLod(uClouds,vUv,0.); col=col*cl.a+cl.rgb;
    if(!inside){float wl=abs(dot(ro,uWater.xyz)-uWater.w-wH(ro)); col+=(uGlowAvg*1.4+uAmbS*.8+vec3(.01,.02,.022))*smoothstep(.045,.0,wl)*.8;}
    vec4 fx_=vec4(0.); vec4 fx=fxAt(mix(vUv,clamp(huv,0.,1.),inside?0.:step(di,1e3)*step(0.,min(huv.x,huv.y)))); if(!bad3(fx.rgb)&&!bad3(vec3(fx.a)))col=col*(1.-fx.a)+min(fx.rgb,vec3(60.));
    if(!inside){
      // outer surface: Fresnel reflection, second-surface reflection, faint smudges and dust
      vec3 nW=mat3(uG2W)*nO; vec3 rW=reflect(dw,nW); vec2 su=vec2(atan(nO.z,nO.x)*.35,nO.y*.5); float sm=textureLod(uN2,su*1.3,0.).r*textureLod(uN2,su*4.1+.3,0.).g; float smudge=smoothstep(.18,.5,sm);
      vec3 rf=roomEnv(rW,.008+.10*smudge*smoothstep(.2,.8,textureLod(uN2,su*.7+.5,0.).r))+bokeh(rW)*.8;
      vec3 n2=normalize(nW+dw*.06); vec3 rf2=roomEnv(reflect(dw,normalize(nW*.93+vec3(0.,.07,0.))),.02)*.45;
      float sh=1.; col=col*(1.-fres*.92)*vec3(.972,.988,.985)+ (rf*1.0+rf2*.6)*(fres*.9+.012);
      float dust=smoothstep(.80,.86,textureLod(uN2,su*23.,0.).r)*smoothstep(.5,.8,textureLod(uN2,su*9.,0.).g); col+=dust*(roomEnv(nW,.6)*.10+uGlowAvg*.01);
      col+=uGlowAvg*pow(1.-sat(dot(-d,nO)),5.)*.35;
    } else {
      float rr=length(uCam);
    }
  }
  if(bad3(col))col=vec3(0.);
  o0=vec4(min(col,vec3(300.)),1.); o1=vec4(dist,interiorFlag,0.,1.);
}`;

// ------------------------------------------------------------------ temporal AA
export const TAA_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0;
uniform sampler2D uCur,uHist,uAux; uniform mat4 uPVPW,uIVPW2; uniform vec3 uCamW; uniform vec2 uJit; uniform float uReset;
vec3 tm(vec3 c){return c/(1.+lum(c));} vec3 itm(vec3 c){return c/max(1.-lum(c),1e-3);}
vec3 ycc(vec3 c){return vec3(dot(c,vec3(.25,.5,.25)),dot(c,vec3(.5,0.,-.5)),dot(c,vec3(-.25,.5,-.25)));}
vec3 rgb(vec3 c){return vec3(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}
vec3 cubic(sampler2D s,vec2 uv){vec2 sz=uRes.xy;vec2 p=uv*sz;vec2 c=floor(p-.5)+.5;vec2 f=p-c;vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f);vec2 w12=w1+w2;vec2 t0=(c-1.)/sz,t3=(c+2.)/sz,t12=(c+w2/w12)/sz;
  vec3 r=textureLod(s,vec2(t12.x,t0.y),0.).rgb*w12.x*w0.y+textureLod(s,vec2(t0.x,t12.y),0.).rgb*w0.x*w12.y+textureLod(s,vec2(t12.x,t12.y),0.).rgb*w12.x*w12.y+textureLod(s,vec2(t3.x,t12.y),0.).rgb*w3.x*w12.y+textureLod(s,vec2(t12.x,t3.y),0.).rgb*w12.x*w3.y;float wt=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y;return max(r/wt,vec3(0.));}
void main(){
  vec2 uv=vUv; vec4 aux=textureLod(uAux,uv,0.); float dm=aux.x;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){float q=textureLod(uAux,uv+vec2(i,j)*uRes.zw,0.).x;dm=min(dm,q);}
  vec3 c0=tm(textureLod(uCur,uv,0.).rgb); vec3 m1=vec3(0.),m2=vec3(0.); vec3 cs=vec3(0.);float ws=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 c=tm(textureLod(uCur,uv+vec2(i,j)*uRes.zw,0.).rgb);vec3 y=ycc(c);m1+=y;m2+=y*y;vec2 dl=vec2(i,j)+uJit;float w=exp(-2.0*dot(dl,dl));cs+=c*w;ws+=w;}
  m1/=9.;m2/=9.;vec3 sg=sqrt(max(m2-m1*m1,vec3(0.))); cs/=ws;
  vec4 h=uIVPW2*vec4(uv*2.-1.,1.,1.); vec3 dir=normalize(h.xyz/h.w-uCamW); vec3 P=uCamW+dir*dm;
  vec4 pv=uPVPW*vec4(P,1.); vec2 pu=pv.xy/pv.w*.5+.5;
  float ok=step(0.,pu.x)*step(pu.x,1.)*step(0.,pu.y)*step(pu.y,1.)*(1.-uReset)*step(0.,pv.w);
  vec3 hi=ycc(tm(cubic(uHist,pu))); vec3 lo=m1-sg*1.15,hh=m1+sg*1.15;
  vec3 e=(hh-lo)*.5+1e-4,ct=(hh+lo)*.5,v=hi-ct;vec3 q=abs(v/e);float mq=max(q.x,max(q.y,q.z));if(mq>1.)hi=ct+v/mq;
  vec3 hist=rgb(hi); float vel=length((pu-uv)*uRes.xy); if(bad3(hist))hist=cs; float al=mix(.075,.16,sat(vel*.2));
  vec3 r=mix(cs,hist,(1.-al)*ok); r=max(itm(r),vec3(0.)); if(bad3(r))r=vec3(0.); o0=vec4(r,1.);
}`;

// ------------------------------------------------------------------ depth of field (gather), bloom, grade
export const COC_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; uniform sampler2D uCur,uAux; uniform float uFocus,uApert;
void main(){vec3 c=min(textureLod(uCur,vUv,0.).rgb,vec3(60.));float d=textureLod(uAux,vUv,0.).x;float coc=clamp((d-uFocus)/max(d,.001)*uApert,-1.,1.);o0=vec4(c,coc);}`;
export const DOF_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; uniform sampler2D uCoc; uniform float uMaxR;
void main(){
  vec4 c0=textureLod(uCoc,vUv,0.); vec3 sum=c0.rgb;float tot=1.; float a0=jit(gl_FragCoord.xy)*6.283; float asp=uRes.y/uRes.x;
  for(int i=1;i<40;i++){float r=sqrt(float(i)/40.);float an=float(i)*2.39996+a0*.12;vec2 o=vec2(cos(an)*asp,sin(an))*r*uMaxR;vec4 s=textureLod(uCoc,vUv+o,0.);
    float sc=abs(s.a); if(s.a>0.)sc=min(sc,max(abs(c0.a)*1.6,0.)+.02); float w=smoothstep(r-.12,r+.06,sc);
    w*=1.+lum(s.rgb)*.06; sum+=s.rgb*w;tot+=w;}
  o0=vec4(sum/tot,abs(c0.a));
}`;
export const DOWN_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; uniform sampler2D uSrc; uniform vec2 uTx; uniform float uFirst;
vec3 S(vec2 o){vec3 c=min(textureLod(uSrc,vUv+o*uTx,0.).rgb,vec3(90.));return c;}
void main(){
  vec3 a=S(vec2(-2,2)),b=S(vec2(0,2)),c=S(vec2(2,2)),d=S(vec2(-2,0)),e=S(vec2(0,0)),f=S(vec2(2,0)),g=S(vec2(-2,-2)),h=S(vec2(0,-2)),i=S(vec2(2,-2)),j=S(vec2(-1,1)),k=S(vec2(1,1)),l=S(vec2(-1,-1)),m=S(vec2(1,-1));
  vec3 r;
  if(uFirst>.5){vec3 g0=(j+k+l+m)*.25,g1=(a+b+d+e)*.25,g2=(b+c+e+f)*.25,g3=(d+e+g+h)*.25,g4=(e+f+h+i)*.25;float w0=1./(1.+lum(g0)*.25),w1=1./(1.+lum(g1)*.25),w2=1./(1.+lum(g2)*.25),w3=1./(1.+lum(g3)*.25),w4=1./(1.+lum(g4)*.25);r=(g0*w0*.5+(g1*w1+g2*w2+g3*w3+g4*w4)*.125)/(w0*.5+(w1+w2+w3+w4)*.125);}
  else r=e*.125+(a+c+g+i)*.03125+(b+d+f+h)*.0625+(j+k+l+m)*.125;
  o0=vec4(max(r,vec3(0.)),1.);
}`;
export const UP_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; uniform sampler2D uSrc,uBase; uniform vec2 uTx; uniform float uMix;
void main(){vec3 s=vec3(0.);vec2 t=uTx;s+=textureLod(uSrc,vUv+vec2(-t.x,-t.y),0.).rgb+textureLod(uSrc,vUv+vec2(t.x,-t.y),0.).rgb+textureLod(uSrc,vUv+vec2(-t.x,t.y),0.).rgb+textureLod(uSrc,vUv+vec2(t.x,t.y),0.).rgb;
 s+=2.*(textureLod(uSrc,vUv+vec2(-t.x,0.),0.).rgb+textureLod(uSrc,vUv+vec2(t.x,0.),0.).rgb+textureLod(uSrc,vUv+vec2(0.,t.y),0.).rgb+textureLod(uSrc,vUv+vec2(0.,-t.y),0.).rgb);s+=4.*textureLod(uSrc,vUv,0.).rgb;s/=16.;
 o0=vec4(textureLod(uBase,vUv,0.).rgb+s*uMix,1.);}`;
export const FINAL_FS = HEAD + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; uniform sampler2D uSharp,uDofT,uBloom; uniform float uExpo,uBloomK,uSlow,uFadeIn; uniform vec2 uOut;
vec3 aces(vec3 v){v=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777)*v;vec3 a=v*(v+.0245786)-.000090537,b=v*(.983729*v+.4329510)+.238081;v=a/b;v=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602)*v;return sat3(v);}
vec3 src(vec2 uv){vec4 d=textureLod(uDofT,uv,0.);vec3 s=textureLod(uSharp,uv,0.).rgb;return mix(s,d.rgb,smoothstep(.05,.24,d.a));}
void main(){
  vec2 q=vUv-.5; float r2=dot(q,q); float ca=.0011*r2*(1.+uSlow*3.);
  vec3 c; c.r=src(vUv+q*ca*3.).r;c.g=src(vUv).g;c.b=src(vUv-q*ca*3.).b;
  // light sharpen of the in-focus image
  vec3 n=textureLod(uSharp,vUv+vec2(uRes.z,0.),0.).rgb+textureLod(uSharp,vUv-vec2(uRes.z,0.),0.).rgb+textureLod(uSharp,vUv+vec2(0.,uRes.w),0.).rgb+textureLod(uSharp,vUv-vec2(0.,uRes.w),0.).rgb; vec3 s0=textureLod(uSharp,vUv,0.).rgb; float da=textureLod(uDofT,vUv,0.).a;
  c+=clamp(s0-n*.25,-.12*(s0+.02),.22*(s0+.02))*(1.-smoothstep(.0,.1,da))*.9;
  c=max(c,vec3(0.));
  vec3 bl=textureLod(uBloom,vUv,0.).rgb; c=mix(c,bl,uBloomK);
  c*=uExpo; c*=mix(1.,smoothstep(1.15,.2,length(q*vec2(uOut.x/uOut.y*.72,1.))),.55);
  c=aces(c*1.05);
  float l=lum(c); c=mix(vec3(l),c,1.08-uSlow*.12); c=mix(c,c*c*(3.-2.*c),.22); c=mix(c,c*vec3(1.0,.995,.985)+vec3(.0,.002,.006)*(1.-l),.8);
  c=pow(c,vec3(1./2.2));
  float g=h21(gl_FragCoord.xy+mod(uFrame,97.)*13.7)-.5; c+=g*.022*(1.-.6*l);
  o0=vec4(c*uFadeIn,1.);
}`;

// ------------------------------------------------------------------ light injection into the five-slice atlas
export const LIGHT_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iA,iB; // iA xyz radius ; iB rgb slice
out vec2 vD; flat out vec3 vC; flat out float vR,vDy;
void main(){
  int s=int(iB.w+.5); float hs=s==0?.05:s==1?.4:s==2?1.3:s==3?3.0:-1.4; float R=iA.w;
  vec2 tile=s==0?vec2(0.):s==1?vec2(.5,0.):s==2?vec2(.75,0.):s==3?vec2(.5,.5):vec2(.75,.5); vec2 sz=s==0?vec2(.5,1.):vec2(.25,.5);
  vDy=(iA.y-LAND)-hs; vD=position.xy*R; vC=iB.rgb; vR=R;
  vec2 uv=(iA.xz+position.xy*R)/20.+.5; vec2 at=tile+clamp(uv,0.,1.)*sz;
  gl_Position=vec4(at*2.-1.,0.,1.); if(dot(iB.rgb,vec3(1.))<1e-4)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const LIGHT_FS = HEAD + /* glsl */`
in vec2 vD; flat in vec3 vC; flat in float vR,vDy; layout(location=0) out vec4 o0;
void main(){float d2=dot(vD,vD);float R2=vR*vR;if(d2>R2)discard;float w=1.-d2/R2;float dy=vDy*vDy;o0=vec4(vC*w*w/(1.+(d2+dy)*9./R2+dy*8.),1.);}`;
// headlight / searchlight cones drawn flat into slice 0
export const CONE_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iA,iB; // iA x z dirx dirz ; iB rgb length
out vec2 vD; flat out vec3 vC;
void main(){vec2 d=iA.zw,n=vec2(-d.y,d.x);float L=iB.w;float w=.25+.75*(position.y*.5+.5);vec2 p=iA.xy+d*(position.y*.5+.5)*L+n*position.x*L*.34*w;vD=vec2(position.x,position.y*.5+.5);vC=iB.rgb;vec2 uv=p/20.+.5;gl_Position=vec4(clamp(uv,0.,1.)*vec2(.5,1.)*2.-1.,0.,1.);if(L<1e-4)gl_Position=vec4(2.,2.,2.,1.);}`;
export const CONE_FS = HEAD + /* glsl */`
in vec2 vD; flat in vec3 vC; layout(location=0) out vec4 o0;
void main(){float y=vD.y;float e=smoothstep(1.,.2,abs(vD.x));o0=vec4(vC*e*smoothstep(0.,.06,y)*pow(1.-y,1.6),1.);}`;

// ------------------------------------------------------------------ fx sprites
export const RAIN_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iS; uniform vec3 uOff,uVel,uCen; uniform float uBox,uShut,uAlpha,uDrop;
out vec2 vU; out float vA; out vec3 vC; flat out float vAsp;
void main(){
  vec3 p=iS.xyz*uBox+uOff*(.82+.36*iS.w); p=mod(p-uCen+uBox*.5,uBox)-uBox*.5+uCen;
  vec3 v=uVel*(.82+.36*iS.w); float sz=uDrop*(.7+.7*fract(iS.w*17.3)); float len=max(length(v)*uShut,sz); vec3 dv=length(v)>1e-4?normalize(v):vec3(0.,-1.,0.);
  vec3 toC=normalize(uCam-p); vec3 sd=normalize(cross(dv,toC)+vec3(1e-5)); float w=max(sz,uD>9.?sz:length(uCam-p)*.0006);
  vec3 P=p+dv*position.y*len*.5+sd*position.x*w*.5; vU=position.xy; vAsp=len/sz;
  float h=terr(p.xz).r; float occ=1.; vec2 tuv=p.xz/20.+.5; if(uWater.y>.8){float td=textureLod(uTopD,tuv,0.).r; float ty=9.6-td*19.2; occ=step(ty-.01,p.y);}
  float in_=step(dot(p,p),RI*RI*.985)*step(uWater.w-.05,dot(p,uWater.xyz))*occ;
  vec3 l=lightVol(p); vec3 bk=envSky(normalize(p-uCam)); vC=(l*1.5+uAmbS*.7+bk*.25+uSunCol*.12+uFlashC*uFlash.w*.9);
  vA=uAlpha*in_; gl_Position=uVP*vec4(P,1.); if(vA<.003)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const RAIN_FS = HEAD + /* glsl */`
in vec2 vU; in float vA; in vec3 vC; flat in float vAsp; layout(location=0) out vec4 o0;
void main(){float y=abs(vU.y);float x=abs(vU.x);float a;vec3 c=vC;
  if(vAsp<2.6){float r=length(vU);a=smoothstep(1.,.85,r);float rim=smoothstep(.4,1.,r);c=vC*(.35+1.3*rim)+vC*3.*smoothstep(.25,.0,length(vU-vec2(-.35,.4)));a*=.85;}
  else a=(1.-x*x)*smoothstep(1.,.2,y)*.5;
  o0=vec4(c*a*vA,a*vA*.35);}`;

// particles: ring buffer, stateless integration. types 0 dust 1 smoke 2 fire 3 spark 4 spray 5 ember 6 debris 7 steam 8 flash
export const PART_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iA,iB,iC; // iA: xyz t0 ; iB: vxyz life ; iC: type size seed heat
out vec2 vU; out vec4 vCol; flat out float vT,vAge,vSeed; out vec3 vW;
void main(){
  float age=uTime-iA.w; float life=iB.w; float k=age/life; int ty=int(iC.x+.5); float sd=iC.z;
  if(age<0.||k>=1.||life<=0.){gl_Position=vec4(2.,2.,2.,1.);return;}
  float drag=ty==3?1.2:ty==4?.7:ty==6?.3:ty==2?1.4:ty==5?1.5:1.7; vec3 v0=iB.xyz; float e=(1.-exp(-drag*age))/drag;
  vec3 p=iA.xyz+v0*e; float gs=ty==3?.7:ty==4?1.:ty==6?1.:0.; p+=uGrav*gs*.5*age*age;
  vec3 upd=-normalize(uGrav+vec3(0.,-1e-4,0.)); if(ty==2)p+=upd*age*(.16+.1*sd); if(ty==5)p+=upd*age*.22; if(ty==1||ty==7)p+=upd*age*(.12+.1*sd);
  float ws=ty==0?.55:ty==1?.8:ty==2?.3:ty==5?.9:ty==7?.7:ty==4?.35:.1; p+=uWind*ws*age*.28*smoothstep(0.,1.2,age);
  if(uTor.w>.05&&ty!=8){vec3 r=p-vec3(uTor.x,0.,uTor.z);float d=length(r.xz);float inf=uTor.w*smoothstep(2.2,.2,d);float a=inf*age*2.6;r.xz=rot(-a)*r.xz;r.xz*=1.-.35*inf*sat(age*.5);p=vec3(uTor.x,0.,uTor.z)+vec3(r.x,r.y+inf*age*.5,r.z);}
  p+=vec3(sin(age*2.3+sd*40.),sin(age*1.9+sd*70.),cos(age*2.1+sd*55.))*.02*(ty<3||ty==7?1.+age:.3);
  float sz=iC.y; float grow=ty==0?1.+3.2*sqrt(k):ty==1?1.+4.5*k:ty==2?1.-.6*k:ty==7?1.+3.*k:ty==4?1.+.8*k:ty==8?1.+k:1.; sz*=grow;
  vec3 f=uCamF; vec3 rt=normalize(cross(f,vec3(0.,1.,.0001))),up=cross(rt,f); vec2 q=position.xy; float a=(sd*6.28)+age*(sd-.5)*1.4; if(ty!=3&&ty!=4){float c=cos(a),s=sin(a);q=mat2(c,-s,s,c)*q;}
  vec3 P=p+(rt*q.x+up*q.y)*sz;
  if(ty==3||ty==4){vec3 v=v0*exp(-drag*age)+uGrav*gs*age;vec3 d=normalize(v+1e-4);vec3 s=normalize(cross(d,f));float ln=ty==3?max(sz*1.5,length(v)*.02):sz*1.6;P=p+d*position.y*ln+s*position.x*sz;}
  vU=position.xy;vT=float(ty);vAge=k;vSeed=sd;vW=p;
  vec3 lv=lightVol(p)+uAmbS*.95+uSunCol*.3+uFlashC*uFlash.w*.5;
  float fi=smoothstep(0.,.08,k);
  if(ty==0)vCol=vec4(vec3(.50,.44,.37)*(lv+uAmbS*.6+vec3(.012)),.66*fi*(1.-k)*(1.-k));
  else if(ty==1)vCol=vec4(vec3(.05,.047,.047)*(lv*.75+uAmbS)+vec3(1.,.3,.05)*.014*iC.w*(1.-k)*(1.-k),.6*fi*(1.-k));
  else if(ty==2)vCol=vec4(1.,1.,1.,fi*(1.-k));
  else if(ty==3)vCol=vec4(vec3(1.,.55,.16)*9.*(1.-k),1.);
  else if(ty==4)vCol=vec4(vec3(.75,.85,.9)*lv,.5*(1.-k));
  else if(ty==5)vCol=vec4(vec3(1.,.36,.06)*7.*(1.-k),1.);
  else if(ty==6)vCol=vec4(vec3(.2,.18,.16)*lv,1.);
  else if(ty==7)vCol=vec4(vec3(.7)*lv,.34*fi*(1.-k));
  else vCol=vec4(vec3(1.,.72,.38)*22.*(1.-k),1.);
  gl_Position=uVP*vec4(P,1.); if(dot(p,p)>RI*RI)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const PART_FS = HEAD + /* glsl */`
in vec2 vU; in vec4 vCol; flat in float vT,vAge,vSeed; in vec3 vW; layout(location=0) out vec4 o0; uniform sampler2D uDepth;
void main(){
  int ty=int(vT+.5); float r=length(vU); if(r>1.)discard; float soft=1.;
  if(ty<3||ty==7){float d=lin2(texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r),z=lin2(gl_FragCoord.z);soft=sat((d-z)/(.03+uD*.004));}
  if(ty==0||ty==1||ty==7){float n=texture(uN2,vU*.22+vSeed*7.+vAge*.1).r,n2=texture(uN2,vU*.6+vSeed*13.-vAge*.2).g;float a=smoothstep(1.,.15,r+(n-.5)*.9)*(.45+.8*n2)*vCol.a*soft;float lit=.7+.5*smoothstep(-.8,.8,vU.y*.6+n-.5);o0=vec4(vCol.rgb*lit*a,a);}
  else if(ty==2){float n=texture(uN2,vU*vec2(.3,.22)+vec2(vSeed*5.,vSeed*9.-uTime*.55)).r,n2=texture(uN2,vU*.6+vec2(vSeed*3.,-uTime*.8)).g;float f=smoothstep(.95,.0,r+(n-.5)*.85+(n2-.5)*.35)*vCol.a*soft;vec3 c=mix(vec3(1.,.10,.01),vec3(1.,.62,.16),smoothstep(.15,.8,f));c=mix(c,vec3(1.,.9,.6),smoothstep(.7,1.,f));o0=vec4(c*f*f*5.5,f*.35);}
  else if(ty==4){float a=smoothstep(1.,.0,r)*vCol.a;o0=vec4(vCol.rgb*a,a*.6);}
  else if(ty==6){o0=vec4(vCol.rgb,1.);if(abs(vU.x)>.6||abs(vU.y)>.5)discard;}
  else if(ty==8){float a=pow(1.-r,2.);o0=vec4(vCol.rgb*a,a*.1);}
  else {float a=pow(1.-r,1.5);o0=vec4(vCol.rgb*a,0.);}
}`;

// additive beams: lasers, searchlights, lighthouse, club movers. ribbon from A to B with two widths
export const BEAM_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iA,iB,iC; // A xyz w0 ; B xyz w1 ; rgb kind
out vec2 vU; flat out vec4 vC; out vec3 vW; flat out vec3 vAa; flat out float vL;
void main(){vec3 a=iA.xyz,b=iB.xyz;float u=position.y*.5+.5;vec3 p=mix(a,b,u);vec3 d=normalize(b-a);vec3 s=normalize(cross(d,uCam-p)+1e-5);float w=mix(iA.w,iB.w,u);w=max(w,length(uCam-p)*.0007);p+=s*position.x*w;vU=vec2(position.x,u);vC=iC;vW=p;vAa=a;vL=length(b-a);gl_Position=uVP*vec4(p,1.);if(iC.w<-.5)gl_Position=vec4(2.,2.,2.,1.);}`;
export const BEAM_FS = HEAD + /* glsl */`
in vec2 vU; flat in vec4 vC; in vec3 vW; flat in vec3 vAa; flat in float vL; layout(location=0) out vec4 o0; uniform sampler2D uDepth;
void main(){
  if(dot(vW,vW)>RI*RI)discard; float x=abs(vU.x); float a;
  if(vC.w<.5){a=exp(-x*x*7.)*(.35+.65*texture(uN3,vW*6.+vec3(0.,uTime*.1,0.)).r);} // laser
  else if(vC.w<1.5){float n=texture(uN3,vW*2.2+vec3(uTime*.02)).r;a=pow(1.-x,1.6)*pow(1.-vU.y,1.3)*(.35+.9*n);} // cone
  else if(vC.w<2.5){a=exp(-x*x*10.)+.35*exp(-x*x*1.5);} // lightning
  else {a=(1.-x*x);} // cable
  float d=lin2(texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r),z=lin2(gl_FragCoord.z); a*=sat((d-z)/(.02)+.0)*step(z,d+.01);
  if(vC.w>2.5){o0=vec4(vC.rgb*a,a*.9);}else o0=vec4(vC.rgb*a,0.);
}`;
export const GLIT_VS = HEAD + /* glsl */`
in vec3 position; in vec4 iA; in float iB; out vec2 vU; flat out vec3 vC; flat out float vA;
void main(){vec3 p=iA.xyz;vec3 f=uCamF;vec3 rt=normalize(cross(f,vec3(0.,1.,.0001))),up=cross(rt,f);float a=uTime*(2.+4.*fract(iB*7.))+iB*40.;vec3 n=normalize(vec3(sin(a),cos(a*.7),sin(a*1.3+1.)));
  float tw=pow(abs(dot(n,normalize(uCam-p))),18.);float tw2=pow(abs(dot(n,uSunDir)),30.);float sz=iA.w*(.6+.4*abs(n.z));vec3 P=p+(rt*position.x*abs(n.x*.6+.4)+up*position.y)*sz;vU=position.xy;
  vec3 l=lightVol(p)+uAmbS+uSunCol*.3;vec3 tint=fract(iB*3.)<.5?vec3(1.,.86,.55):vec3(.9,.95,1.);vC=tint*(l*.5+l*tw*3.+tw2*uSunCol*3.+uFlashC*uFlash.w*(.15+tw*1.2)+vec3(.01)+tw*vec3(.12));vA=uGlitter;gl_Position=uVP*vec4(P,1.);if(uGlitter<.01||dot(p,p)>RI*RI)gl_Position=vec4(2.,2.,2.,1.);}`;
export const GLIT_FS = HEAD + /* glsl */`
in vec2 vU; flat in vec3 vC; flat in float vA; layout(location=0) out vec4 o0; void main(){float r=length(vU);if(r>1.)discard;float a=smoothstep(1.,.6,r)*vA;o0=vec4(vC*a,a*.55);}`;
