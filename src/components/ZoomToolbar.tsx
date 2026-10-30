import {AppButton} from "../features/ui/AppButton";
import {Minus,Plus,RotateCcw,Expand,Minimize} from 'lucide-react';
import './ZoomToolbar.css';

type Props={
  value:number;min:number;max:number;
  onDecrease:()=>void;onIncrease:()=>void;onReset:()=>void;
  fullscreen?:boolean;onToggleFullscreen?:()=>void;
  className?:string;label?:string;
  decreaseLabel?:string;increaseLabel?:string;resetLabel?:string;
};

/** Shared, keyboard-accessible bottom-center toolbar for project covers and review media. */
export function ZoomToolbar({value,min,max,onDecrease,onIncrease,onReset,fullscreen,
  onToggleFullscreen,className='',label='Zoom da imagem',
  decreaseLabel='Reduzir zoom',increaseLabel='Ampliar zoom',resetLabel='Ajustar imagem à tela'}:Props){
  return <div className={'rz-zoom-toolbar '+className} role="group" aria-label="Controles de zoom"
    onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
    <AppButton type="button" aria-label={decreaseLabel} title={decreaseLabel}
      disabled={value<=min+0.001} onClick={onDecrease}><Minus size={18}/></AppButton>
    <output aria-label={label} aria-live="off">{Math.round(value*100)}%</output>
    <AppButton type="button" aria-label={increaseLabel} title={increaseLabel}
      disabled={value>=max-0.001} onClick={onIncrease}><Plus size={18}/></AppButton>
    <span className="rz-toolbar-divider" aria-hidden="true"/>
    <AppButton type="button" aria-label={resetLabel} title={resetLabel}
      onClick={onReset}><RotateCcw size={17}/></AppButton>
    {onToggleFullscreen&&<AppButton type="button"
      aria-label={fullscreen?'Sair da tela cheia':'Ver imagem em tela cheia'}
      title={fullscreen?'Sair da tela cheia':'Ver imagem em tela cheia'}
      onClick={onToggleFullscreen}>{fullscreen?<Minimize size={17}/>:<Expand size={17}/>}</AppButton>}
  </div>;
}
