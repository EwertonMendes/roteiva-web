export function LibraryLoadingRows({count=4,label='Carregando arquivos…'}:{count?:number;label?:string}){
 return <div className="lib-skeleton" role="status" aria-label={label} aria-busy="true">
  {Array.from({length:count},(_,index)=><div className="lib-skeleton-row" key={index} aria-hidden="true">
   <span className="lib-skeleton-icon"/><span className="lib-skeleton-line" style={{width:(52+(index%3)*15)+'%'}}/>
  </div>)}
  <span className="lib-sr-only">{label}</span>
 </div>;
}
