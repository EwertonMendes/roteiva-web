/**
 * Six-blade camera iris, matching the mechanical lens direction approved for the login.
 * Blades are coherent and clipped to the barrel; no overlapping arbitrary polygon.
 * Pure decoration: no assets, network requests or animations.
 */
const polar=(radius:number,degrees:number):[number,number]=>{
  const angle=degrees*Math.PI/180;
  return [200+radius*Math.cos(angle),200+radius*Math.sin(angle)];
};
const point=([x,y]:[number,number])=>`${x.toFixed(2)} ${y.toFixed(2)}`;
const blades=Array.from({length:6},(_,index)=>{
  const turn=index*60;
  const from=point(polar(124,-102+turn));
  const to=point(polar(124,-42+turn));
  const innerFrom=point(polar(54,-155+turn));
  const innerTo=point(polar(54,-95+turn));
  const curveFrom=point(polar(91,-139+turn));
  const curveTo=point(polar(91,-65+turn));
  return `M ${from} A 124 124 0 0 1 ${to} C ${curveTo} ${point(polar(77,-84+turn))} ${innerTo} L ${innerFrom} C ${point(polar(73,-141+turn))} ${curveFrom} ${from} Z`;
});
const aperture=`M ${Array.from({length:6},(_,i)=>point(polar(54,-155+i*60))).join(" L ")} Z`;
const barrelTicks=Array.from({length:120},(_,index)=>{
  const degree=index*3;
  return {inner:point(polar(index%5===0?166:169,degree)),outer:point(polar(175,degree)),major:index%5===0};
});
export function CameraLensArt(){
  return <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="roteiva-iris-body"><stop stopColor="#18191b"/><stop offset=".75" stopColor="#141518"/><stop offset="1" stopColor="#111214"/></radialGradient>
      <linearGradient id="roteiva-iris-blade-0" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#242528"/><stop offset="1" stopColor="#0b0c0e"/></linearGradient>
      <linearGradient id="roteiva-iris-blade-1" x1="0" x2="1" y1="1" y2="0"><stop stopColor="#1d1e20"/><stop offset="1" stopColor="#0e0f12"/></linearGradient>
      <linearGradient id="roteiva-iris-blade-2" x1="0" x2=".8" y1="0" y2="1"><stop stopColor="#151618"/><stop offset="1" stopColor="#27282a"/></linearGradient>
      <clipPath id="roteiva-iris-clip"><circle cx="200" cy="200" r="124"/></clipPath>
    </defs>
    <circle cx="200" cy="200" r="176" fill="#131416" fillOpacity=".25" stroke="#bfc0c6" strokeOpacity=".15" strokeWidth=".8"/>
    <g stroke="#d1d4d9" strokeWidth=".45">
      {barrelTicks.map((tick,i)=><path key={i} d={`M ${tick.inner} L ${tick.outer}`} strokeOpacity={tick.major?".27":".20"}/>)}
    </g>
    <circle cx="200" cy="200" r="166" stroke="#c3c7cb" strokeOpacity=".35" strokeWidth="1.15"/>
    <circle cx="200" cy="200" r="160" stroke="#b7b9be" strokeOpacity=".30" strokeWidth="1.3"/>
    <circle cx="200" cy="200" r="153" stroke="#b7b9be" strokeOpacity=".16" strokeWidth=".65"/>
    <circle cx="200" cy="200" r="139" stroke="#c5c6cb" strokeOpacity=".40" strokeWidth="1"/>
    <circle cx="200" cy="200" r="130" stroke="#c5c6cb" strokeOpacity=".20" strokeWidth=".7"/>
    <circle cx="200" cy="200" r="124" stroke="#c8c9ce" strokeOpacity=".45" strokeWidth="1.4" fill="url(#roteiva-iris-body)"/>
    <g clipPath="url(#roteiva-iris-clip)">
      {blades.map((d,i)=><path key={i} className="camera-lens-blade" d={d}
        fill={`url(#roteiva-iris-blade-${i%3})`} stroke="#b9bbc2" strokeOpacity=".45" strokeWidth="1.15" strokeLinejoin="round"/>)}
    </g>
    <path d={aperture} fill="#0d0e11" stroke="#a1a4ab" strokeOpacity=".38" strokeWidth=".85"/>
    {[-90,0,90,180].map(degrees=>{
      const [cx,cy]=polar(149,degrees);
      return <g key={degrees}>
        <circle cx={cx} cy={cy} r="4.4" stroke="#c8cad1" strokeOpacity=".39" strokeWidth="1"/>
        <circle cx={cx} cy={cy} r="1.15" fill="#a3a6b0" fillOpacity=".34"/>
      </g>;
    })}
  </svg>;
}
