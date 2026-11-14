/** Single official Roteiva logo asset selector. Theme changes never recolor source pixels. */
export function BrandLogo({theme,className,alt="Roteiva"}:{
  theme:"light"|"dark";className?:string;alt?:string;
}){
  const color=theme==="dark"?"white":"black";
  return <img className={className} src={`${import.meta.env.BASE_URL}brand/roteiva-wordmark-${color}.svg`} alt={alt}/>;
}
