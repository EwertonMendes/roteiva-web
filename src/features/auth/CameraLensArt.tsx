/** Lightweight decorative camera lens, in neutral strokes. No layout/identity side effects. */
export function CameraLensArt(){
  return <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="200" cy="200" r="164" stroke="#c5c6ca" strokeOpacity=".36" strokeWidth="1.3"/>
    <circle cx="200" cy="200" r="159" stroke="#9698a1" strokeOpacity=".29" strokeWidth=".8"/>
    <circle cx="200" cy="200" r="148" stroke="#b9bbc0" strokeOpacity=".45" strokeWidth=".9"/>
    <circle cx="200" cy="200" r="137" stroke="#9698a0" strokeOpacity=".25" strokeWidth=".9"/>
    <circle cx="200" cy="200" r="121" stroke="#d0d1d4" strokeOpacity=".47" strokeWidth="1.1"/>
    <circle cx="200" cy="200" r="115" stroke="#8e919a" strokeOpacity=".26" strokeWidth=".7"/>
    <circle cx="200" cy="200" r="105" stroke="#a8aab0" strokeOpacity=".20" strokeWidth=".65"/>
    <g stroke="#d7d8db" strokeOpacity=".66" strokeWidth="1.15" strokeLinejoin="round">
      <path d="M200 95 244 181 188 158 136 215 128 134"/>
      <path d="M244 181 305 219 227 231 236 301 284 271"/>
      <path d="M227 231 168 279 144 195 95 200"/>
      <path d="M168 279 128 134 200 95"/>
      <path d="M136 215 188 158 244 181 227 231 168 279 136 215Z" strokeOpacity=".38"/>
    </g>
    <g stroke="#c7c9ce" strokeOpacity=".45" strokeWidth="1">
      <circle cx="200" cy="49" r="3.2"/><circle cx="351" cy="200" r="3.2"/>
      <circle cx="200" cy="351" r="3.2"/><circle cx="49" cy="200" r="3.2"/>
      <path d="M195 44h10M195 356h10M44 195v10M356 195v10"/>
    </g>
    <g stroke="#92949e" strokeOpacity=".17" strokeWidth=".55">
      {Array.from({length:36},(_,i)=><path key={i} d="M200 31V42" transform={`rotate(${i*10} 200 200)`}/>)}
    </g>
  </svg>;
}
