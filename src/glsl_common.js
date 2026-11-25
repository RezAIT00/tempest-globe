// Shared GLSL: uniforms, noise, light volume, waves, lighting model, G-buffer output.
export const HEAD = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
#define PI 3.14159265
#define RI 9.55
#define RO 10.0
#define LAND -1.72
#define SEA -2.0
#define FLOORH 0.085
uniform mat4 uVP, uPVP, uIVP, uShadowVP;
uniform vec3 uCam, uCamF;
uniform vec4 uRes;       // w,h,1/w,1/h
uniform float uTime, uRT, uFrame, uD, uNear, uFar;
uniform vec3 uSunDir, uSunCol, uAmbS, uAmbG, uHorizon, uZenith;
uniform float uNight, uWet, uStorm, uRain, uFire, uCover, uSpin, uBeat, uPower, uShadowTexel, uFloodLvl, uGlitter;
uniform vec4 uWater;     // plane n.xyz, d
uniform vec4 uFlash;     // pos, intensity
uniform vec3 uFlashC;
uniform vec3 uGrav, uWind;
uniform vec4 uTor, uTor2;      // x,y,z,strength
uniform vec4 uWave;      // calm amp, storm amp, time, choppiness
uniform vec3 uClubOpen;
uniform vec4 uClubP[3];
uniform sampler2D uLight, uHeight, uRoad, uN2;
uniform sampler3D uN3;
uniform sampler2D uShadow, uTopD;
float sat(float x){return clamp(x,0.,1.);}
bool bad3(vec3 c){uvec3 u=floatBitsToUint(c)&uvec3(0x7f800000u);return any(equal(u,uvec3(0x7f800000u)));}
vec3 sat3(vec3 x){return clamp(x,0.,1.);}
float h11(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 h22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
vec3 h33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
float jit(vec2 p){return fract(ign(p)+uFrame*.61803399);}
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 qrot(vec4 q,vec3 v){return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
float lin2(float d){return uNear*uFar/(uFar-d*(uFar-uNear));}
vec4 terr(vec2 xz){return textureLod(uHeight,xz/20.+.5,0.);}

// ---- waves in the water-plane frame
float waveH(vec2 p,float t,float shallow){
  float h=0.,a=1.,f=2.6,s=0.,ang=.4; vec2 q=p;
  for(int i=0;i<4;i++){vec2 d=vec2(cos(ang),sin(ang));float x=dot(d,q)*f+t*(1.1+.28*float(i));float w=exp(sin(x)-1.);h+=w*a;q-=d*w*cos(x)*a*.05;s+=a;a*=.66;f*=1.55;ang+=2.13;}
  float r=(h/s-.46)*uWave.x;
  if(uWave.y>.002){float H=0.;a=1.;f=.85;s=0.;ang=1.9;q=p;
    for(int i=0;i<5;i++){vec2 d=vec2(cos(ang),sin(ang));float x=dot(d,q)*f+t*(1.5+.35*float(i));float w=exp(sin(x)-1.);H+=w*a;q-=d*w*cos(x)*a*.16;s+=a;a*=.7;f*=1.42;ang+=1.47;}
    r+=(H/s-.42)*uWave.y;}
  return r*shallow;
}

// ---- five-slice light volume (ground, low, mid, high, underwater)
vec3 lsl(int s,vec2 uv,float lod){
  uv=clamp(uv,.004,.996);
  if(s==0)return textureLod(uLight,vec2(uv.x*.5,uv.y),lod).rgb;
  vec2 o=s==1?vec2(.5,0.):s==2?vec2(.75,0.):s==3?vec2(.5,.5):vec2(.75,.5);
  return textureLod(uLight,o+vec2(uv.x*.25,uv.y*.5),0.).rgb;
}
vec3 lightVol(vec3 q){
  vec2 uv=q.xz/20.+.5; float h=q.y-LAND;
  if(h<-.35){return mix(lsl(0,uv,0.)*.5,lsl(4,uv,0.),sat((-.35-h)*1.4));}
  vec3 r=lsl(3,uv,0.)*exp(-max(h-3.,0.)*.9); if(h<.4)return mix(lsl(0,uv,0.),lsl(1,uv,0.),sat(h/.4));
  if(h<1.3)return mix(lsl(1,uv,0.),lsl(2,uv,0.),(h-.4)/.9);
  if(h<3.)return mix(lsl(2,uv,0.),lsl(3,uv,0.),(h-1.3)/1.7);
  return r;
}

// ---- interior sky
vec3 envSky(vec3 d){
  float h=d.y;
  vec3 c=mix(uHorizon,uZenith,smoothstep(-.08,.65,h));
  if(h<-.02)c=mix(c,uAmbG*.6,smoothstep(0.,-.35,h));
  float s=max(dot(d,uSunDir),0.);
  c+=uSunCol*(pow(s,900.)*14.+pow(s,24.)*.12);
  c+=uFlashC*uFlash.w*.05;
  return c;
}

float shadowAt(vec3 P,vec3 N,vec2 fc){
  vec4 s=uShadowVP*vec4(P+N*uShadowTexel*2.2,1.); vec3 c=s.xyz*.5+.5;
  if(any(lessThan(c,vec3(.002)))||any(greaterThan(c,vec3(.998))))return 1.;
  float a=jit(fc)*6.2832,r=0.; vec2 tx=1./vec2(textureSize(uShadow,0));
  for(int i=0;i<8;i++){float k=sqrt((float(i)+.5)/8.)*2.3;float an=a+float(i)*2.39996;vec2 o=vec2(cos(an),sin(an))*k;float d=textureLod(uShadow,c.xy+o*tx,0.).r;r+=step(c.z-.0009,d);}
  return r/8.;
}
`;

export const OPAQUE_FS = /* glsl */`
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
struct Surf{vec3 alb;vec3 N;float rough;float metal;vec3 emi;float ao;float refl;float sss;};
float ggx(float nh,float r){float a=r*r;a*=a;float d=nh*nh*(a-1.)+1.;return a/(PI*d*d+1e-6);}
float caust(vec2 p,float t){
  mat2 m=mat2(1.6,1.2,-1.2,1.6);float c=0.;vec2 q=p*3.1;
  for(int i=0;i<3;i++){q+=vec2(sin(q.y*1.3+t),cos(q.x*1.1-t*.8))*.55;q=m*q*.55+.3;c+=abs(sin(q.x)*cos(q.y));}
  return pow(sat(1.25-c*.62),3.)*3.2;
}
void finish(Surf s,vec3 P,vec3 extraSpec){
  if(dot(P,P)>RI*RI*1.002)discard;
  vec3 V=normalize(uCam-P); vec3 N=dot(s.N,s.N)>1e-8?normalize(s.N):V;
  float under=uWater.w-dot(P,uWater.xyz);
  vec3 sunC=uSunCol; float ca=0.;
  if(under>0.){sunC*=exp(-under*vec3(.75,.22,.14));ca=caust(P.xz,uTime*1.1)*exp(-under*.35);}
  float nl=max(dot(N,uSunDir),0.);
  float sh=nl>0.?shadowAt(P,N,gl_FragCoord.xy):0.;
  vec3 H=normalize(V+uSunDir+vec3(0.,1e-5,0.));
  float nv=clamp(dot(N,V),.02,1.),nh=sat(dot(N,H)),vh=sat(dot(V,H));
  vec3 F0=mix(vec3(.04),s.alb,s.metal); vec3 F=F0+(1.-F0)*pow(1.-vh,5.);
  float rr=max(s.rough,.09);
  float D=ggx(nh,rr),k=(rr+1.)*(rr+1.)/8.,G=nl/(nl*(1.-k)+k)/(nv*(1.-k)+k)*.25;
  vec3 dif=s.alb*(1.-s.metal);
  vec3 c=(dif/PI+min(D*G,40.)*F)*sunC*nl*sh*3.14159*(1.+ca*.4);
  if(s.sss>0.)c+=dif*sunC*s.sss*(.25+.75*pow(max(dot(-V,uSunDir),0.),3.))*.5;
  vec3 amb=mix(uAmbG,uAmbS,N.y*.5+.5);
  if(under>0.){float k2=exp(-under*.32);amb=amb*k2*vec3(.35,.85,1.)+vec3(.010,.05,.066)*(1.-k2)*(.35+.65*s.ao);}
  vec3 lv=lightVol(P+N*.085);
  vec3 lvr=lightVol(P+reflect(-V,N)*.28);
  c+=dif*(amb*s.ao+lv*(.35+.65*s.ao));
  vec3 Fa=F0+(max(vec3(1.-s.rough),F0)-F0)*pow(1.-nv,5.);
  c+=Fa*lvr*(.5+s.rough*.5)*mix(1.,.35,s.refl)*s.ao;
  if(s.refl<.02)c+=Fa*envSky(reflect(-V,N))*s.ao*(1.-s.rough*.75)*sat(N.y*.5+.8);
  // lightning as a positional light
  if(uFlash.w>.001){vec3 l=uFlash.xyz-P;float d2=dot(l,l);l/=sqrt(d2);c+=dif*uFlashC*uFlash.w*max(dot(N,l)*.8+.2,0.)*5.5/(d2+9.);}
  c+=s.emi+extraSpec;
  float el=lum(s.emi);
  if(bad3(c))c=vec3(0.); o0=vec4(clamp(c,vec3(0.),vec3(90.)),sat(el/(lum(c)+1e-4)));
  o1=vec4(N,floor(sat(s.refl)*15.)+clamp(s.rough,0.,1.)*.94);
}
`;

// body transforms texture fetch
export const BODY = /* glsl */`
uniform sampler2D uBody;
void body(int id,out vec4 P,out vec4 Q){int k=id*2;P=texelFetch(uBody,ivec2(k&255,k>>8),0);Q=texelFetch(uBody,ivec2((k+1)&255,(k+1)>>8),0);}
`;
