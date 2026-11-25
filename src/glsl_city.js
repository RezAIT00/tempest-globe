import { HEAD, OPAQUE_FS, BODY } from './glsl_common.js';

// ------------------------------------------------------------------ building chunks
export const CHUNK_VS = HEAD + BODY + /* glsl */`
in vec3 position, normal;
in vec3 iHome, iHalf; in vec4 iInfo; in float iId;   // iInfo: building, mask, layer, kind
out vec3 vP,vN,vL,vLN,vLV; flat out vec4 vI; flat out float vHeat; flat out int vId;
void main(){
  vec4 bp,bq; int id=int(iId+.5); body(id,bp,bq);
  vec3 p=position,n=normal;
  #ifdef ROUND
  int k=int(iInfo.w+.5)-1; vec2 sg=vec2((k&1)!=0?-1.:1.,(k&2)!=0?-1.:1.);
  p.xz*=sg; n.xz*=sg;
  #endif
  vec3 lp=p*iHalf;
  vL=iHome+lp; vLN=n;
  vec3 P=bp.xyz+qrot(bq,lp);
  vP=P; vN=qrot(bq,n);
  vec4 iq=vec4(-bq.xyz,bq.w);
  vLV=qrot(iq,P-uCam);
  vI=iInfo; vHeat=bp.w; vId=id;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(P,1.);
  #else
  gl_Position=uVP*vec4(P,1.);
  #endif
  if(bp.w<-.5)gl_Position=vec4(2.,2.,2.,1.);
}`;

export const CHUNK_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vL,vLN,vLV; flat in vec4 vI; flat in float vHeat; flat in int vId;
uniform sampler2D uBld;
vec4 bt(int b,int k){return texelFetch(uBld,ivec2(k,b),0);}
// parallax room behind a window
vec3 room(vec2 rf,vec3 d,vec2 rs,float seed,float lit,out float lamp){
  float dep=.085; vec3 p=vec3(rf*rs,0.);
  vec3 inv=1./(abs(d)+1e-4);
  float tx=(d.x>0.?rs.x-p.x:p.x)*inv.x, ty=(d.y>0.?rs.y-p.y:p.y)*inv.y, tz=dep*inv.z;
  float t=min(min(tx,ty),tz); vec3 h=p+d*t;
  vec3 wall=mix(vec3(.72,.62,.5),vec3(.5,.58,.62),h11(seed+3.1)); wall=mix(wall,vec3(.6,.36,.3),step(.86,h11(seed+9.)));
  vec3 c=wall;
  if(t==ty)c=d.y>0.?vec3(.85):vec3(.25,.16,.1);
  else if(t==tz){float pic=step(abs(fract(h.x/rs.x*2.+h11(seed))-.5),.22)*step(abs(h.y/rs.y-.62),.16);c=mix(c,mix(vec3(.3),vec3(h11(seed+1.),h11(seed+2.),h11(seed+4.)),.45)*.6,pic);}
  // furniture card
  float tf=dep*.55*inv.z; if(tf<t){vec3 q=p+d*tf;float fx=fract(q.x/rs.x*2.+h11(seed+7.));float fh=rs.y*(.22+.3*h11(seed+floor(q.x/rs.x*2.+h11(seed+7.))));if(q.y<fh&&abs(fx-.5)<.34){c=vec3(.16,.1,.07)*(1.+h11(seed+5.));}}
  float tp=dep*.4*inv.z; if(tp<t){vec3 q=p+d*tp;float px=q.x-rs.x*(.5+.32*sin(uTime*.15*(h11(seed+1.3)-.3)+seed));float py=q.y;float per=step(.45,h11(seed+12.));if(per>.5&&py<.043&&length(vec2(px/.007,(py-.036)/.007))<1.||per>.5&&py<.03&&abs(px)<.008)c=vec3(.05,.045,.05);}
  vec3 lc=mix(vec3(1.,.66,.34),vec3(.75,.88,1.),step(.74,h11(seed+21.)));
  lc=mix(lc,vec3(1.,.3,.45),step(.985,h11(seed+33.)));
  float fall=1./(1.+dot(h-vec3(rs.x*.5,rs.y,dep*.5),h-vec3(rs.x*.5,rs.y,dep*.5))*500.);
  lamp=lit; return c*lc*(.35+1.5*fall);
}
void main(){
  Surf s; s.alb=vec3(.5);s.N=normalize(vN);s.rough=.8;s.metal=0.;s.emi=vec3(0.);s.ao=1.;s.refl=0.;s.sss=0.;
  int b=int(vI.x+.5),mask=int(vI.y+.5),kind=int(vI.w+.5);
  vec4 b0=bt(b,0),b1=bt(b,1),b2=bt(b,2),b3=bt(b,3);
  vec3 L=vL-vec3(b0.x,LAND,b0.y); int style=int(b1.x+.5); float seed=b1.y,H=b1.z,power=b1.w;
  vec3 n=vLN; float heat=vHeat; float loose=0.; if(heat>1.5){heat-=2.;loose=1.;}
  // club roof and near walls dissolve as the camera comes in
  if(kind>=10&&loose<.5){
    int k=int(b3.w+.5); float op=k==0?uClubOpen.x:k==1?uClubOpen.y:uClubOpen.z;
    if(op>.001){vec3 tc=normalize(uCam-vP); vec3 nn=kind==10?vec3(0,0,1):kind==11?vec3(0,0,-1):kind==12?vec3(1,0,0):vec3(-1,0,0);
      vec3 cc=uCam-vec3(b0.x,LAND+.08,b0.y); float face=kind==14?1.:smoothstep(.05,.3,dot(normalize(cc),nn));
      if(op*face>jit(gl_FragCoord.xy)*.98+.01)discard;}
  }
  bool outer=false; vec3 an=abs(n); float u=0.; float uw=0.;
  #ifdef ROUND
  outer=true; float ang=atan(n.z,n.x);
  if(an.y>.7){outer=(n.y>0.&&(mask&4)!=0);} else {int k=kind-1; vec2 sg=vec2((k&1)!=0?-1.:1.,(k&2)!=0?-1.:1.); if(an.x>.985)outer=(mask&(n.x>0.?1:2))!=0;else if(an.z>.985)outer=(mask&(n.z>0.?16:32))!=0;else if(dot(n.xz,sg)<-.01)outer=false; bool xf=an.x>an.z; u=xf?-L.z*sign(n.x):L.x*sign(n.z);}
  #else
  if(an.x>.5){outer=(mask&(n.x>0.?1:2))!=0;u=L.z*sign(n.x)*-1.;uw=b0.w;}
  else if(an.z>.5){outer=(mask&(n.z>0.?16:32))!=0;u=L.x*sign(n.z);uw=b0.z;}
  else outer=(n.y>0.)&&(mask&4)!=0;
  #endif
  float v=L.y; vec3 stone=b2.rgb;
  vec2 px=vec2(length(vec2(dFdx(u),dFdy(u))),length(vec2(dFdx(v),dFdy(v))))+1e-5;
  float grime=texture(uN2,vec2(u*.9+seed*7.,v*.35)).r; float fine=texture(uN2,vec2(u,v)*6.+seed).g;
  if(!outer&&kind>=10&&an.y<.7){
    // club lining: quilted velvet and brass fins
    float uu=an.x>.5?L.z:L.x; float fin=smoothstep(.06,.02,abs(fract(uu*16.)-.5)); float ar=abs(fract(uu*8.+.5)-.5)*2.; float q=smoothstep(.02,.0,abs(v-.05-.07*(1.-ar*ar)));
    s.alb=mix(vec3(.05,.012,.03)*(.7+.5*fine),vec3(.9,.62,.26),max(fin*step(v,.045),q)); s.metal=max(fin*step(v,.045),q); s.rough=mix(.85,.25,s.metal); s.ao=.8;
  } else if(!outer&&kind>=10){s.alb=vec3(.02);
  } else if(!outer){
    // fracture faces: slabs, rebar, plaster, burning edges
    float fl=abs(fract(v/FLOORH)-.5); float slab=smoothstep(.36,.42,fl);
    vec2 q=an.y>.5?L.xz:vec2(u,v); float nn=texture(uN2,q*3.1+seed).r,n2=texture(uN2,q*11.+seed).g;
    s.alb=mix(vec3(.2,.17,.15),vec3(.46,.44,.42),slab)*(.55+.7*nn);
    s.alb=mix(s.alb,mix(vec3(.6,.35,.22),vec3(.35,.45,.5),step(.5,fract(seed*7.3+floor(v/FLOORH)*.37))),(1.-slab)*step(.45,nn)*.6);
    s.alb*=.6+.6*n2; s.rough=.95; s.ao=.75;
    s.N=normalize(s.N+(vec3(nn,n2,texture(uN2,q*7.).r)-.5)*1.1);
    s.emi+=vec3(1.,.28,.04)*pow(sat(heat*1.2),2.)*smoothstep(.45,.75,n2*.6+nn*.5+.1*sin(uTime*7.+nn*30.))*5.;
  } else if(an.y>.7){
    float g=texture(uN2,L.xz*5.).r; s.alb=mix(vec3(.16,.155,.15),vec3(.32,.31,.3),g)*(.7+.4*fine); s.rough=mix(.9,.15,uWet*smoothstep(.45,.6,texture(uN2,L.xz*1.3+seed).r)); s.refl=uWet*.35*step(s.rough,.6);
    if(kind>=10){s.alb=vec3(.03);}
  } else {
    float fh=FLOORH, fl=floor(v/fh); vec2 f; float bay=style==2?.085:style==1?.04:style==3?.05:.0425;
    f=vec2(fract(u/bay),fract(v/fh)); float bi=floor(u/bay);
    float wl=smoothstep(.0,.1,uNight);
    if(kind>=10){
      // club facade: lacquered panels with sunburst inlay
      vec2 q=vec2(u,v); float a=atan(q.y+.05,q.x); float ray=smoothstep(.46,.5,abs(fract(a*7.)-.5)); s.alb=mix(vec3(.018,.016,.024),vec3(.85,.6,.25),ray*step(v,.17)*.8); s.metal=ray; s.rough=.22; s.refl=.5;
      s.emi+=b3.rgb*(.18+.35*uBeat)*smoothstep(.02,.0,abs(v-.03-.02*sin(u*40.+uTime*3.)))*power;
      float door=step(abs(u),.055)*step(v,.11); s.alb=mix(s.alb,vec3(.02),door); s.emi+=b3.rgb*door*(.5+uBeat)*power;
    } else if(v<fh*1.12){
      // storefront
      float sb=.14; float si=floor(u/sb+.5*seed),sf=fract(u/sb+.5*seed); float sid=h21(vec2(si,seed*91.));
      float w=smoothstep(.05,.05+px.x/sb,sf)*smoothstep(.95,.95-px.x/sb,sf)*smoothstep(.012,.012+px.y,v)*smoothstep(.078,.078-px.y,v);
      vec3 d=normalize(vLV); float du=an.x>.5?d.z*sign(n.x)*-1.:d.x*sign(n.z); float dn=abs(dot(d,n));
      float lamp; vec3 rc=room(vec2(sf,v/.09),vec3(du,d.y,max(dn,.05)),vec2(sb,.09),sid*37.+seed,1.,lamp);
      vec3 sc=mix(vec3(1.,.75,.45),0.5+0.5*cos(6.28*(sid+vec3(0.,.33,.67))),.45);
      float shelf=.6+.8*step(.5,fract(v*70.))*step(.35,h21(vec2(floor(u*160.),floor(v*70.))));
      s.alb=mix(mix(vec3(.05),stone*.35,step(.5,seed)),vec3(.02),w); s.rough=mix(.5,.06,w); s.refl=mix(uWet*.2,.45,w); s.metal=0.;
      float open=step(.12,sid);
      s.emi+=w*rc*sc*shelf*(.35+1.5*uNight)*power*open*1.25;
    } else {
      float lit=0.; vec2 room_=vec2(bay*2.,fh); float ri=floor(u/room_.x); float id=h21(vec2(ri*1.7+fl*31.3,seed*57.+floor(n.x*2.+n.z*5.+.5)));
      float on=step(id,mix(.07,.5,uNight)+.05*sin(floor(uTime*.21+id*40.)*13.)); on*=power;
      float flick=id>.93?step(.3,h11(floor(uTime*9.)+id*77.)):1.;
      vec2 wm; vec4 wr;
      if(style==0){wr=vec4(.18,.82,.16,.80);} else if(style==1){wr=vec4(.12,.88,.06,.78);} else if(style==2){wr=vec4(.04,.96,.28,.74);} else {wr=vec4(.16,.84,.14,.84);}
      vec2 pf=px/vec2(bay,fh);
      float wx=smoothstep(wr.x-pf.x*.5,wr.x+pf.x*.5,f.x)*smoothstep(wr.y+pf.x*.5,wr.y-pf.x*.5,f.x);
      float wy=smoothstep(wr.z-pf.y*.5,wr.z+pf.y*.5,f.y)*smoothstep(wr.w+pf.y*.5,wr.w-pf.y*.5,f.y);
      float far=smoothstep(.5,1.6,max(pf.x,pf.y)); float w=mix(wx*wy,(wr.y-wr.x)*(wr.w-wr.z),far);
      float mull=smoothstep(.04+pf.x,.0,abs(f.x-.5))*step(pf.x,.2)*(style==2?0.:1.);
      // wall
      vec3 wall=stone*(.72+.4*grime)*(.88+.24*fine);
      float spand=1.-wy;
      if(style==0){wall=mix(wall,wall*.42,wx*spand*.75);float ch=smoothstep(.1,.0,abs(abs(f.x-.5)*1.2-abs(f.y-(f.y>.5?1.:0.))*1.1)-.05);wall=mix(wall,vec3(.85,.6,.25),ch*wx*spand*.55*(1.-far));}
      if(style==1){wall=mix(wall,vec3(.95,.66,.28),smoothstep(.1,.02,abs(f.x-.02))*.8*(1.-far));s.rough=.25;s.refl=.22;}
      if(style==2){float band=smoothstep(.06,.0,abs(f.y-.1));wall=mix(wall,b3.rgb*.35+.25,band*.35);}
      if(style==3){float tile=smoothstep(.0,.08,fract(v/fh*4.))*smoothstep(.0,.06,fract(u/bay*3.));wall*=.75+.3*tile;float z=abs(fract(u/bay)-.5);wall=mix(wall,vec3(.9,.78,.5),smoothstep(.06,.0,abs(z*.6-(1.-f.y)*.4))*step(.82,f.y)*.5*(1.-far));s.rough=.35;}
      wall*=1.-.35*smoothstep(.35,.0,v/H)*grime; // street soot
      wall*=1.-.25*smoothstep(.3,.8,texture(uN2,vec2(u*4.,v*.18+seed)).g)*(1.-far); // rain streaks
      s.alb=wall; s.rough=style==1?.22:style==3?.38:.72; if(uWet>.1){s.rough=mix(s.rough,s.rough*.6,uWet);s.alb*=1.-.22*uWet;}
      // fake relief at the window reveals
      vec3 tg=an.x>an.z?vec3(0.,0.,-sign(n.x)):vec3(sign(n.z),0.,0.);
      #ifndef ROUND
      float rx=(smoothstep(.06,.0,abs(f.x-wr.x))-smoothstep(.06,.0,abs(f.x-wr.y)))*wy,ry=(smoothstep(.06,.0,abs(f.y-wr.z))-smoothstep(.06,.0,abs(f.y-wr.w)))*wx;
      s.N=normalize(s.N+(qrot(vec4(0.,0.,0.,1.),tg)*rx+vec3(0.,1.,0.)*ry)*.7*(1.-far)*(loose>.5?0.:1.));
      #endif
      if(w>.01){
        vec3 d=normalize(vLV); float du=dot(d,tg),dn=max(abs(dot(d,n)),.06);
        float lamp; vec3 rc;
        vec2 rf=vec2(fract(u/room_.x),f.y);
        rc=far>.9?mix(vec3(.75,.5,.28),vec3(.5,.6,.7),step(.74,h11(id*37.+21.)))*.75:room(rf,vec3(du,d.y,dn),room_,id*37.+seed,1.,lamp);
        float blind=step(.55,h11(id*91.))*step(1.-.75*h11(id*17.),(f.y-wr.z)/(wr.w-wr.z)); rc=mix(rc,vec3(.8,.55,.32)*(.55+.2*sin(f.y*90.)),blind*.8*(1.-far));
        float g=w*(1.-mull*.9);
        s.alb=mix(s.alb,vec3(.015,.02,.024),g); s.rough=mix(s.rough,.05,g); s.refl=mix(s.refl,.5*(1.-on*.55),g);
        float inten=mix(.9,2.6,h11(id*5.)*h11(id*3.3+seed));
        s.emi+=g*rc*(on*flick*inten*(.25+.95*uNight)+ (1.-on)*.04*lum(uAmbS));
        // television flicker
        float tv=step(.86,h11(id*63.))*on; s.emi+=g*tv*vec3(.2,.45,1.)*(.4+.6*h11(floor(uTime*6.)+id*99.))*uNight*.8;
      }
    }
    // soot and scorching
    float so=sat(heat*1.4)*smoothstep(.2,.8,grime+heat*.5); s.alb*=1.-.9*so; s.emi*=1.-so*.95;
    s.emi+=vec3(1.,.25,.03)*smoothstep(.62,.9,texture(uN2,vec2(u,v)*2.3+seed+uTime*.02).r*.7+heat*.45)*heat*4.*(.6+.4*sin(uTime*11.+u*60.));
    if(loose>.5){float cr=smoothstep(.06,.0,abs(texture(uN2,vec2(u,v)*1.7+seed).b-.5));s.alb=mix(s.alb,vec3(.1),cr*.7);}
  }
  if(dot(s.N,uCam-vP)<0.)s.N=-s.N;
  finish(s,vP,vec3(0.));
}`;

export const DEPTH_FS = HEAD + /* glsl */`
void main(){}`;

// ------------------------------------------------------------------ attachments (parented to chunks)
export const ATT_VS = HEAD + BODY + /* glsl */`
in vec3 position, normal; in vec4 iPos,iScl,iCol; in vec3 iRot;
out vec3 vP,vN,vC,vO; flat out float vMat,vSeed; out vec3 vLp; flat out float vPow; flat out vec3 vScl; flat out float vClub; flat out vec2 vCC;
uniform sampler2D uBld;
in float iBld;
void main(){
  vec3 p=position*iScl.xyz,n=normal/iScl.xyz;
  float cy=cos(iRot.x),sy=sin(iRot.x),cz=cos(iRot.y),sz=sin(iRot.y);
  p.xy=vec2(cz*p.x-sz*p.y,sz*p.x+cz*p.y); n.xy=vec2(cz*n.x-sz*n.y,sz*n.x+cz*n.y);
  p.xz=vec2(cy*p.x+sy*p.z,-sy*p.x+cy*p.z); n.xz=vec2(cy*n.x+sy*n.z,-sy*n.x+cy*n.z);
  n=normalize(n); p+=iPos.xyz; float hide=0.; vPow=1.;
  if(iPos.w>=0.){vec4 bp,bq;body(int(iPos.w+.5),bp,bq);p=bp.xyz+qrot(bq,p);n=qrot(bq,n);if(bp.w<-.5)hide=1.;}
  vClub=-1.;vCC=vec2(0.); if(iBld>=0.){vPow=texelFetch(uBld,ivec2(1,int(iBld+.5)),0).w;vClub=texelFetch(uBld,ivec2(3,int(iBld+.5)),0).w;vCC=texelFetch(uBld,ivec2(0,int(iBld+.5)),0).xy;} else vPow=uPower;
  vP=p;vN=n;vC=iCol.rgb;vMat=iScl.w;vSeed=iCol.w;vO=position;vLp=p;vScl=iScl.xyz;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(p,1.);
  #else
  gl_Position=uVP*vec4(p,1.);
  #endif
  if(hide>.5)gl_Position=vec4(2.,2.,2.,1.);
}`;

export const ATT_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vC,vO; flat in float vMat,vSeed; in vec3 vLp; flat in float vPow; flat in vec3 vScl; flat in float vClub; flat in vec2 vCC;
void clubCut(){if(vClub>-.5){float op=vClub<.5?uClubOpen.x:vClub<1.5?uClubOpen.y:uClubOpen.z;vec2 a=normalize(uCam.xz-vCC),b=normalize(vP.xz-vCC);float f=max(smoothstep(-.1,.35,dot(a,b)),smoothstep(LAND+.205,LAND+.22,vP.y));if(op*f>jit(gl_FragCoord.xy)*.98+.01)discard;}}
vec3 hue(float h){return .5+.5*cos(6.2832*(h+vec3(0.,.33,.67)));}
void main(){
  clubCut();
  Surf s; s.alb=vC;s.N=normalize(vN);s.rough=.62;s.metal=0.;s.emi=vec3(0.);s.ao=1.;s.refl=0.;s.sss=0.;
  int m=int(vMat+.5); float n=texture(uN2,vLp.xz*4.+vLp.y*3.).r;
  float ng=mix(.06,1.,smoothstep(.05,.35,uNight));
  if(m==1){s.alb*=.72+.45*n;s.rough=mix(.65,.32,uWet*.7);s.alb*=1.-.15*uWet;}
  else if(m==2||m==6){
    float fl=vSeed>.94?step(.35,h11(floor(uTime*13.)+vSeed*91.)):1.;
    if(m==6)fl=.65+.35*sin(uTime*5.+vP.x*30.+vP.z*30.);
    float core=.55+.45*pow(abs(dot(normalize(uCam-vP),s.N)),1.5);
    vec3 c=mix(vC,vec3(1.),.16*core); s.alb=vec3(.2);s.emi=c*core*7.5*vPow*ng*fl;
  }
  else if(m==3){s.metal=1.;s.rough=.24;s.alb*=.85+.2*n;s.refl=.3;}
  else if(m==4){s.emi=vC*2.2*vPow*(.15+.85*ng);s.rough=.2;}
  else if(m==5){s.emi=vC*14.*step(.0,sin(uTime*2.6+vSeed*6.));}
  else if(m==7){s.alb=vec3(.045)*(.7+.6*n);s.rough=mix(.85,.12,uWet);s.refl=uWet*.8;float ln=smoothstep(.03,.0,abs(vO.z))*step(.5,fract(vP.x*8.));if(vO.y>.4)s.alb=mix(s.alb,vec3(.8,.65,.2),ln);}
  else if(m==10){
    // LED dance floor
    vec2 q=vP.xz*38.; vec2 g=floor(q),f=abs(fract(q)-.5); float e=smoothstep(.5,.44,max(f.x,f.y)); int k=int(vC.r+.5);
    float bt=floor(uBeat*0.+uTime*2.1); float r=length(g-vec2(0.)); float pat=k==0?.5+.5*sin(r*.9-uTime*6.):k==1?step(.5,h21(g+bt)):.5+.5*sin(g.x*.8+uTime*4.)*sin(g.y*.8-uTime*3.);
    vec3 c=hue(fract(bt*.13+pat*.35+float(k)*.33)); s.alb=vec3(.03);s.rough=.09;s.refl=.6; s.emi=c*e*(pat*pat)*(.2+1.0*uBeat)*vPow*.8;
  }
  else if(m==11){
    // LED wall: generative visuals
    vec2 q=vO.xy; int k=int(vC.r+.5); float t=uTime; vec2 a=q*vec2(vScl.x/vScl.y,1.); float led=.72+.28*sin(vP.x*1200.)*sin(vP.y*1200.);
    vec3 c;
    if(k==0){vec2 f=a+vec2(0.,.5);float r=length(f),an=atan(f.x,f.y);float ray=smoothstep(.42,.5,abs(fract(an*3.8+sin(t*.4)*.4)-.5));float rings=smoothstep(.36,.5,abs(fract(r*5.-t*1.1)-.5));float rain=smoothstep(.93,1.,sin(a.x*60.+sin(floor(a.x*19.))*9.)*.5+.5)*smoothstep(.6,1.,fract(q.y*1.3+t*.9+h11(floor(a.x*19.))));c=mix(vec3(.0,.06,.10),vec3(.0,.20,.22),1.-r*.5)+vec3(.1,.95,.75)*ray*exp(-r*.9)*.7+vec3(1.,.62,.2)*rings*ray*.8+vec3(.5,.9,1.)*rain*.8;}
    else if(k==1){float r=length(a),an=atan(a.y,a.x);float z=.3/(r+.05)+t*1.4;c=hue(z*.12)*(.5+.5*sin(z*6.+an*5.))*smoothstep(.02,.3,r);}
    else {c=vec3(0.);for(int i=0;i<4;i++){float fi=float(i);a+=.12*sin(a.yx*6.+t*(1.+fi*.3)+fi);c+=hue(fi*.2+t*.07)*.02/(abs(a.y+.08*sin(a.x*9.+t+fi))+.015);}}
    if(vC.g>.5)c=hue(q.x*.5+t*.3)*step(abs(q.y),.1+.4*uBeat*abs(sin(q.x*17.)));
    s.alb=vec3(.02);s.emi=c*led*(.5+.9*uBeat)*vPow;
  }
  else if(m==12){float r=length(vec2(vO.x,fract(vO.y*3.+.5)-.5));s.alb=mix(vec3(.02),vec3(.09),step(r,.4)*step(.1,r));s.rough=.5;}
  else if(m==13){vec2 unused=vec2(0.);float b=step(.35,abs(fract(vP.z*110.+vP.x*110.)-.5)*2.);vec3 c=hue(h21(floor(vP.zy*vec2(110.,28.))))*.6+vC*.6;float sh=step(.25,fract(vP.y*28.));s.alb=c*.2;s.emi=c*b*sh*.55*vPow;}
  else if(m==14){vec3 d=normalize(vO);vec2 g=floor(vec2(atan(d.z,d.x)*7.+uTime*2.,d.y*9.));s.alb=vec3(.9);s.metal=1.;s.rough=.1;s.refl=.7;s.N=normalize(s.N+(vec3(h21(g),h21(g+3.),h21(g+7.))-.5)*.5);s.emi=hue(h21(g))*step(.86,h21(g+floor(uTime*8.)))*9.*vPow;}
  if(!gl_FrontFacing)s.N=-s.N;
  finish(s,vP,vec3(0.));
}`;

// ------------------------------------------------------------------ neon signs (atlas)
export const SIGN_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP,vN,vC,vO; flat in float vMat,vSeed; in vec3 vLp; flat in float vPow; flat in vec3 vScl; flat in float vClub; flat in vec2 vCC;
uniform sampler2D uAtlas;
void main(){
  if(vClub>-.5){float op=vClub<.5?uClubOpen.x:vClub<1.5?uClubOpen.y:uClubOpen.z;if(op>jit(gl_FragCoord.xy)*.98+.01)discard;}
  Surf s; s.alb=vec3(.03);s.N=normalize(vN);s.rough=.4;s.metal=.2;s.emi=vec3(0.);s.ao=1.;s.refl=.1;s.sss=0.;
  float w=floor(vMat); float vert=w>=100.?1.:0.; w-=vert*100.;
  vec2 q=vO.xy+.5; if(vO.z<0.)q.x=1.-q.x;
  if(abs(vO.z)>.4){
    vec2 uv; if(vert>.5)uv=vec2((floor(w)+q.x)/20.,.5+.5*q.y);else uv=vec2((mod(w,4.)+q.x)/4.,.5-(floor(w/4.)+1.-q.y)/10.);
    vec4 t=texture(uAtlas,uv); float fl=vSeed>.9?step(.3,h11(floor(uTime*15.)+vSeed*71.)):1.; float ch=.82+.18*sin(uTime*3.+vSeed*9.);
    float ng=mix(.1,1.,smoothstep(.05,.35,uNight));
    s.emi=(mix(vC,vec3(1.),t.g*.35)*t.r*5.5+vC*t.b*.8)*vPow*fl*ch*ng; s.alb=mix(vec3(.02),vec3(.1),t.b);
  }
  if(!gl_FrontFacing)s.N=-s.N;
  finish(s,vP,vec3(0.));
}`;

// ------------------------------------------------------------------ terrain
export const TERR_VS = HEAD + /* glsl */`
in vec3 position; out vec3 vP;
void main(){vec3 p=position;p.y=terr(p.xz).r;vP=p;
  #ifdef SHADOW
  gl_Position=uShadowVP*vec4(p,1.);
  #else
  gl_Position=uVP*vec4(p,1.);
  #endif
}`;
export const TERR_FS = HEAD + OPAQUE_FS + /* glsl */`
in vec3 vP;
vec4 rd(vec2 c){return texelFetch(uRoad,ivec2(clamp(c+8.,0.,16.)),0);}
vec3 ripples(vec2 p,float amt){
  vec3 n=vec3(0.,1.,0.);
  for(int k=0;k<2;k++){float sc=k==0?38.:61.;vec2 q=p*sc,c=floor(q);
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=c+vec2(i,j);vec2 h=h22(g+float(k)*17.);float ph=fract(uTime*(.8+.5*h.x)+h.y);vec2 o=g+.2+.6*h22(g+floor(uTime*(.8+.5*h.x)+h.y))-q;float r=length(o);float w=sin((r-ph*.9)*32.)*smoothstep(.16,.0,abs(r-ph*.9))*(1.-ph);n.xz+=normalize(o+1e-4)*w*.35*amt;}}
  return normalize(n);
}
void main(){
  Surf s; s.alb=vec3(.5);s.rough=.9;s.metal=0.;s.emi=vec3(0.);s.ao=1.;s.refl=0.;s.sss=0.;
  vec2 p=vP.xz; vec4 tx=terr(p); float d=tx.g;
  float e=20./512.; vec3 N=normalize(vec3(terr(p-vec2(e,0.)).r-terr(p+vec2(e,0.)).r,2.*e,terr(p-vec2(0.,e)).r-terr(p+vec2(0.,e)).r)); s.N=N;
  float n1=texture(uN2,p*.7).r,n2=texture(uN2,p*4.3).g,n3=texture(uN2,p*17.).r,n4=texture(uN2,p*61.).g;
  float pxw=length(fwidth(p));
  // ---- natural ground
  vec3 sand=vec3(.76,.66,.47)*(.8+.3*n2)*(.9+.2*n4); float wetSand=smoothstep(.16,.02,d+(n1-.5)*.1);
  sand*=1.-.5*wetSand; float sandR=mix(.95,.18,wetSand*smoothstep(.0,.06,d));
  vec3 grass=mix(vec3(.07,.15,.035),vec3(.16,.25,.06),n2)*(.65+.7*n4);
  vec3 rock=mix(vec3(.2,.19,.18),vec3(.42,.38,.33),n2)*(.5+.8*n3);
  vec3 bed=mix(vec3(.55,.5,.38),vec3(.16,.3,.27),smoothstep(.35,.7,n1))*(.5+.6*n2); bed=mix(bed,mix(vec3(.5,.12,.2),vec3(.6,.35,.08),n3)*.8,smoothstep(.62,.75,texture(uN2,p*1.9).b)*.55);
  s.alb=d>.0?sand:bed; s.rough=d>.0?sandR:.9; if(d>0.&&wetSand>.3)s.refl=.35*wetSand;
  if(N.y<.72)s.alb=mix(rock,s.alb,smoothstep(.45,.72,N.y));
  float city=smoothstep(.45,.47,d);
  vec2 cell=floor(p); vec2 fr=p-cell;
  if(city>0.){
    vec4 r00=rd(cell),r10=rd(cell+vec2(1.,0.)),r01=rd(cell+vec2(0.,1.));
    vec2 rn=floor(p+.5); vec2 dd=abs(p-rn);
    float hEx=rd(vec2(cell.x,rn.y)).r, vEx=rd(vec2(rn.x,cell.y)).g;
    float dh=hEx>.2?dd.y:9., dv=vEx>.2?dd.x:9.;
    float hw=abs(d-.64)-.0;
    float road=min(dh,dv)-.13; road=min(road,hw-.15);
    float walk=min(dh,dv)-.185; walk=min(walk,hw-.185);
    float bt=r00.a*255./50.;
    float aa=max(pxw*.7,.0006);
    // lot interior
    vec3 lot=bt>1.5&&bt<2.5?grass:mix(vec3(.3,.29,.27),vec3(.42,.4,.37),n2);
    if(bt<.5)lot=mix(grass,sand*.8,smoothstep(.45,.6,n1+n2*.2));
    float lr=.9;
    if(bt>1.5&&bt<2.5){ // park paths
      vec2 q=fr-.5; float pa=min(abs(abs(q.x)-abs(q.y))*.7,abs(length(q)-.17)); float pm=smoothstep(.022+aa,.022-aa,pa); lot=mix(lot,vec3(.5,.45,.38)*(.7+.4*n3),pm); lr=mix(.95,.7,pm);
    }
    if(bt>3.5||(bt>.5&&bt<1.5)){vec2 q=fract(p*18.);float jn=smoothstep(.0,.06,min(q.x,q.y));lot*=.8+.2*jn;lr=.6;}
    s.alb=lot;s.rough=lr;
    // sidewalk slabs and kerb
    float wm=smoothstep(aa,-aa,walk); vec2 sq=abs(fract(p*22.)-.5); float joint=smoothstep(.5,.46,max(sq.x,sq.y));
    vec3 wc=mix(vec3(.36,.35,.34),vec3(.46,.44,.42),n2)*(.75+.25*mix(joint,1.,smoothstep(.01,.03,pxw)))*(.85+.2*n4); float ter=step(.5,fract((floor(p.x*22.)+floor(p.y*22.))*.5)); wc*=.94+.1*ter;
    s.alb=mix(s.alb,wc,wm);s.rough=mix(s.rough,.62,wm);
    float kerb=smoothstep(.008+aa,.004,abs(road-.004)); s.alb=mix(s.alb,vec3(.55),kerb*.6);
    // asphalt
    float am=smoothstep(aa,-aa,road);
    if(am>0.){
      float patch_=smoothstep(.55,.57,texture(uN2,floor(p*3.)*.37).r); float crack=smoothstep(.035,.0,abs(texture(uN2,p*1.3).b-.5))*smoothstep(.45,.6,n1);
      vec3 as=vec3(.052,.052,.056)*(.75+.5*n4)*(.85+.3*n2)*(1.-.3*patch_); as*=1.-.55*crack;
      float lane=0.,yel=0.; bool hwy=hw-.15<min(dh,dv)-.13;
      float tyre=0.;
      if(hwy){float o=d-.64;float al=atan(p.y,p.x)*55.;yel=smoothstep(.004+aa,.004-aa,abs(abs(o)-.006));lane=smoothstep(.0035+aa,.0035-aa,abs(abs(o)-.075))*step(.45,fract(al));lane=max(lane,smoothstep(.003+aa,.003-aa,abs(abs(o)-.142)));tyre=smoothstep(.02,.0,abs(fract(abs(o)/.07)*.07-.035-.016));}
      else{
        bool inter=dh<.13&&dv<.13;
        float o=dh<dv?dh:dv; float al=dh<dv?p.x:p.y; float dn=dh<dv?dd.x:dd.y;
        if(!inter){
          yel=smoothstep(.0028+aa,.0028-aa,abs(o-.005))*step(.2,dn); lane=smoothstep(.0025+aa,.0025-aa,abs(o-.068))*step(.5,fract(al*9.))*step(.24,dn)*0.;
          float other=dh<dv?dv:dh;
          // crosswalk + stop line
          if(other<2.){float z=other-.13; float cw=step(.012,z)*step(z,.052); lane=max(lane,cw*step(.5,fract((dh<dv?p.y:p.x)*24.))); lane=max(lane,smoothstep(.004,.003,abs(z-.066))*step(0.,(dh<dv?(p.y-rn.y)*(p.x-rn.x):-(p.x-rn.x)*(p.y-rn.y))*1.));}
          tyre=smoothstep(.02,.0,abs(abs(o-.065)-.022));
        }
      }
      float wear=.55+.45*n3; as*=1.-.18*tyre;
      as=mix(as,vec3(.72,.72,.68)*wear,lane*.85); as=mix(as,vec3(.78,.55,.12)*wear,yel*.85);
      vec2 mp=fract(p*2.3+.31)-.5; float mh=smoothstep(.034+aa,.034-aa,length(mp)/2.3*1.6); as=mix(as,vec3(.1,.09,.085),mh*step(.7,h21(floor(p*2.3+.31))));
      s.alb=mix(s.alb,as,am); s.rough=mix(s.rough,.86,am);
    }
    // wetness, puddles, ripples
    float pav=max(am,wm*.8); if(bt>3.5||(bt>.5&&bt<1.5))pav=max(pav,.6);
    float pud=smoothstep(.52-.2*uWet,.64-.16*uWet,texture(uN2,p*.83+.2).r*.75+n1*.3)*uWet; pud*=am>.5?1.:.45;
    pud=max(pud,smoothstep(.03,.0,abs(road+.012))*uWet*am*.8);
    float wt=uWet*pav;
    s.alb*=mix(1.,.5,wt);
    s.rough=mix(s.rough,mix(.3,.2,n3),wt*.85); s.rough=mix(s.rough,.025,pud*pav);
    s.refl=max(s.refl,wt*mix(.42,1.,pud));
    float bump=1.-pud; s.N=normalize(s.N+vec3(n4-.5,0.,n3-.5)*(.22*bump+.03)*(1.-smoothstep(.004,.02,pxw)));
    if(uRain>.02&&pxw<.012)s.N=normalize(s.N+(ripples(p,uRain)-vec3(0.,1.,0.))*pud*(1.-smoothstep(.004,.012,pxw)));
    if(bt>1.5&&bt<2.5&&walk>0.)s.sss=.15;
  } else if(uWet>0.&&d>0.){s.alb*=1.-.3*uWet;}
  finish(s,vP,vec3(0.));
}`;
