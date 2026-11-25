import { HEAD, OPAQUE_FS } from './glsl_common.js';

// ------------------------------------------------------------------ generic instanced meshes
// color.a = material: 0 paint, 1 glass, 2 rubber/black, 3 chrome, 4 headlight, 5 taillight, 6 strobe A, 7 strobe B, 8 neon, 9 raw, 10 LED hull
export const MESH_VS = HEAD + /* glsl */`
in vec3 position, normal; in vec4 color; in float aSpin;
in vec4 iPos,iQuat,iCol;       // iPos.w scale, iCol.w state
out vec3 vP,vN,vO; out vec4 vC; flat out vec4 vT; out vec3 vON;
void main(){
  vec3 p=position,n=normal;
  if(aSpin>.5){
    float a=uTime*(aSpin<1.5?38.:52.);
    #ifdef WHEELROT
    a=iCol.w;
    #endif
    if(aSpin<1.5){float c=cos(a),s=sin(a);p.xz=mat2(c,-s,s,c)*p.xz;n.xz=mat2(c,-s,s,c)*n.xz;}
    else{vec3 o=vec3(-.62,.1,.02);p-=o;float c=cos(a),s=sin(a);p.xy=mat2(c,-s,s,c)*p.xy;p+=o;}
  }
  vO=p;
  #ifdef CRANE
  p.y=p.y>.9?(p.y-1.)+iCol.w:p.y*iCol.w; vO=p;
  #endif
  vec3 P=iPos.xyz+qrot(iQuat,p*iPos.w); vP=P;vN=qrot(iQuat,n);vC=color;vT=iCol;vON=n;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(P,1.);
  #else
  gl_Position=uVP*vec4(P,1.);
  #endif
  if(iPos.w<1e-5)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const MESH_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vO; in vec4 vC; flat in vec4 vT; in vec3 vON;
void main(){
  Surf s; s.alb=vC.rgb;s.N=normalize(vN);s.rough=.5;s.metal=0.;s.emi=vec3(0.);s.ao=1.;s.refl=0.;s.sss=0.;
  int m=int(vC.a+.5); float on=step(.06,uNight);
  if(m==0){s.alb=vT.rgb*vC.rgb;s.rough=.2;s.refl=.34;s.metal=.15;s.alb*=.93+.12*texture(uN2,vO.xz*9.).r;}
  else if(m==1){s.alb=vec3(.012);s.rough=.04;s.refl=.62;}
  else if(m==2){s.alb=vC.rgb;s.rough=.8;
    #ifdef CRANE
    bool mast=vO.y<vT.w-.02; float L=mast?vO.y:vO.x; float c=mast?(abs(vON.x)>.5?vO.z:vO.x)/.017:(abs(vON.y)>.5?vO.z:vO.y-vT.w-.02)/.013; float k=fract(L*15.)*2.-1.; float tr=min(abs(abs(c)-1.)-.0,min(abs(c-k),abs(fract(L*15.)-.5)>.46?0.:1.)); if(tr>.22)discard; s.rough=.5;
    #endif
  }
  else if(m==3){s.alb=vC.rgb;s.metal=1.;s.rough=.16;s.refl=.4;}
  else if(m==4){s.emi=vec3(1.,.93,.78)*mix(1.,15.,on)*step(.0,vT.w);}
  else if(m==5){s.emi=vec3(1.,.03,.02)*(mix(.6,4.5,on)+step(.5,fract(vT.w))*4.)*step(.0,vT.w);}
  else if(m==6){float k=step(.5,fract(uTime*3.1))*step(.35,fract(uTime*12.4));s.emi=vec3(1.,.03,.03)*(.3+16.*k)*step(.0,vT.w);}
  else if(m==7){float k=step(fract(uTime*3.1),.5)*step(.35,fract(uTime*12.4));s.emi=vec3(.05,.15,1.)*(.3+18.*k)*step(.0,vT.w);}
  else if(m==8){s.emi=vC.rgb*6.5*mix(.2,1.,on)*uPower;}
  else if(m==10){float t=uTime*.6;float u=vO.x*5.-t;vec3 c=.5+.5*cos(6.28*(u*.15+vec3(0.,.33,.67)));float g=step(.25,fract(vO.x*60.))*step(.25,fract(vO.y*60.));s.emi=c*g*(1.2+.8*sin(u*3.+vO.y*9.))*2.4*mix(.25,1.,on);s.alb=vec3(.05);}
  else if(m==11){s.alb=vT.rgb*vC.rgb;s.rough=.85;}
  if(vT.w<-1.5){s.alb*=.25;s.rough=.9;s.refl=0.;}
  if(!gl_FrontFacing)s.N=-s.N;
  finish(s,vP,vec3(0.));
}`;

// ------------------------------------------------------------------ people (GPU skinned, procedural motion)
// aLimb: 0 torso 1 head 2 armL 3 foreL 4 armR 5 foreR 6 thighL 7 shinL 8 thighR 9 shinR 10 hair
export const PERSON_VS = HEAD + /* glsl */`
in vec3 position, normal; in float aLimb;
in vec4 iPos,iQuat,iAnim,iLook;  // iAnim: mode, phase, speed, seed ; iLook: skin, top, bottom, hair
out vec3 vP,vN; flat out vec4 vLk; flat out float vLimb; out vec3 vO; flat out float vMode;
vec3 rx(vec3 p,vec3 o,float a){p-=o;float c=cos(a),s=sin(a);p.yz=vec2(c*p.y-s*p.z,s*p.y+c*p.z);return p+o;}
vec3 rz(vec3 p,vec3 o,float a){p-=o;float c=cos(a),s=sin(a);p.xy=vec2(c*p.x-s*p.y,s*p.x+c*p.y);return p+o;}
vec3 ry(vec3 p,float a){float c=cos(a),s=sin(a);p.xz=vec2(c*p.x+s*p.z,-s*p.x+c*p.z);return p;}
void pose(inout vec3 p,inout vec3 n){
  int L=int(aLimb+.5); float mode=iAnim.x,ph=iAnim.y,sd=iAnim.w; vec3 z=vec3(0.);
  float aL=0.,aR=0.,eL=0.,eR=0.,tL=0.,tR=0.,kL=0.,kR=0.,sL=.08,sR=-.08,hipY=0.,tw=0.,lean=0.,hd=0.,sx=0.;
  if(mode<.5){aL=.06*sin(uTime+sd*9.);eL=.12;eR=.12;tw=.1*sin(uTime*.6+sd*20.);hd=.3*sin(uTime*.45+sd*50.);}           // idle
  else if(mode<1.5){float s=sin(ph),c=cos(ph);aL=s*.6;aR=-s*.6;eL=.35;eR=.35;tL=-s*.55;tR=s*.55;kL=max(0.,c)*.9;kR=max(0.,-c)*.9;hipY=-abs(s)*.012;tw=s*.1;lean=.05;} // walk
  else if(mode<2.5){float s=sin(ph),c=cos(ph);aL=s*1.1;aR=-s*1.1;eL=1.6;eR=1.6;tL=-s*.95;tR=s*.95;kL=max(0.,c)*1.5+.2;kR=max(0.,-c)*1.5+.2;hipY=abs(c)*.04;tw=s*.2;lean=.28;} // run
  else if(mode<3.5){ // dance
    float b=uTime*6.5973+sd*.6; float st=floor(sd*5.); float s=sin(b*.5+sd*6.),c=abs(sin(b*.5));
    hipY=-.035*c;kL=.35*c;kR=.35*c;tL=-.18*c;tR=-.18*c;hd=.2*s;
    if(st<1.){sL=2.5+.25*s;sR=-2.5+.25*s;eL=.3+.4*c;eR=.3+.4*c;sx=.03*s;}
    else if(st<2.){aL=-1.3+.5*s;aR=-1.3-.5*s;eL=1.2+.5*s;eR=1.2-.5*s;tw=.35*s;}
    else if(st<3.){sR=-2.7;aR=0.;eR=.2+.5*c;sL=.4;eL=1.2;tw=.25*sin(b*.25);sx=.035*s;hipY-=.02*c;}
    else if(st<4.){tw=.6*s;aL=.7*s;aR=-.7*s;eL=1.5;eR=1.5;tL=-.35*max(0.,s);tR=-.35*max(0.,-s);kL=.6*max(0.,s);kR=.6*max(0.,-s);}
    else {sL=1.5+.35*sin(b*.5+1.);sR=-1.5+.35*sin(b*.5+1.);eL=.5+.5*s;eR=.5-.5*s;sx=.05*s;}
  }
  else if(mode<4.5){tL=-1.5;tR=-1.5;kL=1.5;kR=1.5;hipY=-.23;aL=-.4;aR=-.4;eL=.6;eR=.6;hd=.2*sin(uTime*.5+sd*9.);}      // sit
  else if(mode<5.5){aL=-2.3;aR=-2.3;eL=1.9;eR=1.9;tL=-1.2;tR=-1.2;kL=1.9;kR=1.9;hipY=-.3;lean=.6;}                       // cower
  else if(mode<6.5){float t=uTime*14.+sd*30.;aL=sin(t)*1.6;aR=sin(t*1.1+1.)*1.6;sL=.9+.6*sin(t*.8);sR=-.9-.6*sin(t*.9);tL=sin(t*.9)*.9;tR=sin(t*.85+2.)*.9;kL=.6+.6*sin(t*.7);kR=.6+.6*cos(t*.8);eL=.8;eR=.8;} // flail
  else if(mode<7.5){float s=sin(ph*1.3);aR=-1.9;eR=.3;aL=-1.4+.2*s;eL=.9;tw=.15*s;lean=.15;}                             // working / spraying
  else {float s=sin(uTime*5.+sd*9.);aL=s*2.2-1.;aR=-s*2.2-1.;lean=1.2;tL=s*.3;tR=-s*.3;}                                  // swim
  vec3 shL=vec3(.105,.80,0.),shR=vec3(-.105,.80,0.),elL=vec3(.125,.62,0.),elR=vec3(-.125,.62,0.),hpL=vec3(.05,.5,0.),hpR=vec3(-.05,.5,0.),knL=vec3(.052,.27,0.),knR=vec3(-.052,.27,0.);
  if(L==3||L==5){vec3 o=L==3?elL:elR;float a=L==3?eL:eR;p=rx(p,o,-a);n=rx(n,z,-a);}
  if(L==2||L==3){p=rx(p,shL,aL);n=rx(n,z,aL);p=rz(p,shL,sL);n=rz(n,z,sL);}
  if(L==4||L==5){p=rx(p,shR,aR);n=rx(n,z,aR);p=rz(p,shR,sR);n=rz(n,z,sR);}
  if(L==7||L==9){vec3 o=L==7?knL:knR;float a=L==7?kL:kR;p=rx(p,o,a);n=rx(n,z,a);}
  if(L==6||L==7){p=rx(p,hpL,tL);n=rx(n,z,tL);}
  if(L==8||L==9){p=rx(p,hpR,tR);n=rx(n,z,tR);}
  if(L==1||L==10){p=ry(p,hd);n=ry(n,hd);}
  if(L<6||L==10){vec3 o=vec3(0.,.5,0.);p=rx(p,o,lean);n=rx(n,z,lean);p=ry(p,tw);n=ry(n,tw);}
  p.y+=hipY;p.x+=sx;
}
void main(){
  vec3 p=position,n=normal; pose(p,n);
  float sx=mix(.92,1.1,fract(iAnim.w*7.7)); p.xz*=sx; p.y*=mix(.93,1.05,fract(iAnim.w*3.3));
  vec3 P=iPos.xyz+qrot(iQuat,p*iPos.w); vP=P;vN=qrot(iQuat,n);vLk=iLook;vLimb=aLimb;vO=position;vMode=iAnim.x;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(P,1.);
  #else
  gl_Position=uVP*vec4(P,1.);
  #endif
  if(iPos.w<1e-5)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const PERSON_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN; flat in vec4 vLk; flat in float vLimb; in vec3 vO; flat in float vMode;
vec3 pal(float t){t=fract(t);int k=int(t*12.);return k==0?vec3(.7,.08,.07):k==1?vec3(.06,.1,.3):k==2?vec3(.85,.82,.75):k==3?vec3(.02,.02,.025):k==4?vec3(.05,.4,.35):k==5?vec3(.85,.55,.08):k==6?vec3(.75,.25,.4):k==7?vec3(.3,.1,.4):k==8?vec3(.12,.35,.6):k==9?vec3(.9,.9,.92):k==10?vec3(.35,.22,.12):vec3(.5,.55,.2);}
void main(){
  Surf s;s.N=normalize(vN);s.rough=.75;s.metal=0.;s.emi=vec3(0.);s.ao=.75+.25*smoothstep(0.,.5,vO.y);s.refl=0.;s.sss=.12;
  int L=int(vLimb+.5); vec3 skin=mix(vec3(.9,.66,.52),vec3(.2,.1,.06),vLk.x); vec3 top=pal(vLk.y),bot=pal(vLk.z*.97+.23); vec3 c=top;
  float st=fract(vLk.y*31.7);
  if(L==1)c=skin; else if(L==10)c=mix(vec3(.02,.015,.012),vec3(.6,.4,.16),step(.7,vLk.w)*fract(vLk.w*9.));
  else if(L==3||L==5)c=(st<.6||vO.y<.46)?skin:top; else if(L==2||L==4)c=(st<.15)?skin:top;
  else if(L==6||L==8)c=bot; else if(L==7||L==9)c=vO.y<.05?vec3(.03):(fract(vLk.z*17.)<.35?skin:bot);
  else if(L==0&&vO.y<.53)c=bot;
  if(L==0&&vO.y>=.53){float q=fract(vLk.y*77.);if(q<.2)c=mix(c,vec3(.95),step(.5,fract(vO.y*22.)));else if(q<.3)c=mix(c,pal(vLk.y+.4),step(.5,fract(vO.x*14.+vO.y*14.)));if(q>.85&&vO.z>.02&&abs(vO.x)<.02)c=vec3(.9);}
  if(L==1){ // face
    if(vO.z>.03){float ex=abs(abs(vO.x)-.02);if(ex<.0085&&abs(vO.y-.925)<.005)c=vec3(.02);if(abs(vO.x)<.014&&abs(vO.y-.882)<.0035)c=vec3(.5,.15,.13);}
    s.sss=.3;
  }
  if(vLk.y>1.){c=vec3(.95,.45,.05);if(fract(vO.y*12.)>.72&&L<6)s.emi=vec3(.7,.8,.5)*.6;if(L==10||L==1&&vO.y>.93)c=vec3(.95,.8,.1);} // emergency crew
  s.alb=c*.85;
  finish(s,vP,vec3(0.));
}`;

// ------------------------------------------------------------------ foliage
export const FOL_VS = HEAD + /* glsl */`
in vec3 position, normal; in vec4 color; in vec4 iPos,iQuat,iCol;
out vec3 vP,vN; out vec4 vC; flat out vec4 vT;
void main(){
  vec3 p=position; float sw=color.a; vec3 wd=uWind; float st=length(wd);
  vec4 iq=vec4(-iQuat.xyz,iQuat.w);
  float grav=iCol.w; // 0 rooted, 1 torn off
  vec3 tv=vec3(uTor.x-iPos.x,0.,uTor.z-iPos.z); float td=length(tv)+.2; vec3 tw=(cross(vec3(0.,1.,0.),tv/td)*-1.+tv/td*.6)*uTor.w*min(2.2,1.3/td);
  wd+=tw*2.; st=length(wd);
  vec3 lw=qrot(iq,wd)*(1.-grav);
  float ph=iPos.x*3.+iPos.z*2.; float gust=.7+.3*sin(uTime*3.+ph)+.25*sin(uTime*7.3+ph*2.+p.x*4.);
  float bend=min(st*.16,.75)*gust;
  vec3 off=normalize(lw+vec3(1e-4))*bend*sw*sw*.9; off.y-=bend*bend*sw*.35;
  off+=vec3(sin(uTime*2.1+ph+p.y*4.),0.,cos(uTime*1.7+ph+p.x*5.))*.012*sw*(1.+st);
  p+=off;
  vec3 P=iPos.xyz+qrot(iQuat,p*iPos.w);vP=P;vN=qrot(iQuat,normal);vC=color;vT=iCol;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(P,1.);
  #else
  gl_Position=uVP*vec4(P,1.);
  #endif
  if(iPos.w<1e-5)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const FOL_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN; in vec4 vC; flat in vec4 vT;
void main(){if(uD<5.){float fd=length(vP-uCam);if(smoothstep(uD*.22,uD*.62,fd)<jit(gl_FragCoord.xy)*.98+.01)discard;}Surf s;s.alb=vC.rgb*mix(vec3(1.),vT.rgb,.8)*(.75+.5*texture(uN2,vP.xz*23.+vP.y*9.).g);s.N=normalize(vN);if(!gl_FrontFacing)s.N=-s.N;s.rough=mix(.7,.4,uWet);s.metal=0.;s.emi=vec3(0.);s.ao=.85;s.refl=0.;s.sss=vC.g>vC.r?.2:0.;finish(s,vP,vec3(0.));}`;

// ------------------------------------------------------------------ fish & other swimmers: fully GPU-driven, living in the water-plane frame
export const FISH_VS = HEAD + /* glsl */`
in vec3 position, normal; in vec4 color; in vec4 iA,iB;  // iA: school centre seed, orbit r, depth, speed ; iB: offset xyz, size
out vec3 vP,vN,vC; flat out float vK;
uniform vec3 uWX,uWZ;
void main(){
  float sp=iA.w,ph=iA.x*6.2832; float t=uTime*sp+ph;
  float wob=.35*sin(t*1.7+iA.x*30.);
  float r=iA.y+wob*.3+.25*sin(t*2.3+iB.x*5.); float dep=iA.z+.12*sin(t*2.1+iB.y*9.);
  vec3 c=vec3(cos(t)*r,0.,sin(t)*r); vec3 tan=normalize(vec3(-sin(t),.0,cos(t))*sign(sp));
  vec3 side=cross(vec3(0.,1.,0.),tan);
  float jx=sin(uTime*1.3+iB.x*40.)*.05;
  vec3 o=side*(iB.x+jx)+tan*iB.z+vec3(0.,iB.y+.03*sin(uTime*1.9+iB.z*30.),0.);
  vec3 C=c+o; float y=-dep+o.y;
  vec3 p=position*iB.w; float wag=sin(uTime*(9.+iB.x*6.)*(.5+abs(sp)*4.)-position.x*5.+iB.z*20.);
  p.z+=wag*.12*iB.w*smoothstep(.2,-.6,position.x);
  vec3 q=tan*p.x+vec3(0.,1.,0.)*p.y+side*p.z; vec3 nn=tan*normal.x+vec3(0.,1.,0.)*normal.y+side*normal.z;
  vec3 W0=uWater.xyz*(uWater.w+y)+uWX*C.x+uWZ*C.z; vec3 W=W0+uWater.xyz*q.y+uWX*q.x+uWZ*q.z;
  vec3 n=uWX*nn.x+uWater.xyz*nn.y+uWZ*nn.z;
  // keep out of the sea bed while upright
  float th=terr(W0.xz).r; float up=smoothstep(.7,.95,uWater.y); float fix_=max(0.,th+.10+iB.w*.22-W0.y)*up; W.y+=fix_; W0.y+=fix_;
  float hide=max(step(uWater.w-.04,dot(W0,uWater.xyz)),step(RI*RI*.955,dot(W0,W0)));
  vP=W;vN=n;vC=color.rgb;vK=iB.y;
  gl_Position=uVP*vec4(W,1.); if(hide>.5)gl_Position=vec4(2.,2.,2.,1.);
}`;
export const FISH_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vC; flat in float vK;
void main(){Surf s;s.alb=vC;s.N=normalize(vN);if(!gl_FrontFacing)s.N=-s.N;s.rough=.3;s.metal=0.;s.emi=vC*(.012+.02*uNight);s.ao=1.;s.refl=0.;s.sss=.3;finish(s,vP,vec3(0.));}`;
// coral, kelp: rooted, swaying
export const CORAL_VS = HEAD + /* glsl */`
in vec3 position, normal; in vec4 color; in vec4 iPos,iQuat,iCol; out vec3 vP,vN,vC;
void main(){vec3 p=position;float k=color.a;p.x+=k*sin(uTime*.9+iPos.x*4.+p.y*2.)*.16*p.y;p.z+=k*cos(uTime*.8+iPos.z*4.+p.y*2.5)*.16*p.y;
  vec3 P=iPos.xyz+qrot(iQuat,p*iPos.w);vP=P;vN=qrot(iQuat,normal);vC=color.rgb*iCol.rgb;gl_Position=uVP*vec4(P,1.);}`;
export const CORAL_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vC;
void main(){Surf s;s.alb=vC*(.6+.7*texture(uN2,vP.xz*9.+vP.y*7.).r);s.N=normalize(vN);if(!gl_FrontFacing)s.N=-s.N;s.rough=.8;s.metal=0.;s.emi=vC*.035*uNight;s.ao=.8;s.refl=0.;s.sss=.25;finish(s,vP,vec3(0.));}`;
