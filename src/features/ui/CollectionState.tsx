import {LoaderCircle} from "lucide-react";
import type {ReactNode} from "react";

/** Presentation-only loading or empty state for data collections.
 * The parent remains responsible for fetching, paging, and errors.
 */
export function CollectionState({message,loading=false,title,icon,compact=false,children,className=""}:{
  message:string;loading?:boolean;title?:string;icon?:ReactNode;
  compact?:boolean;children?:ReactNode;className?:string;
}){
  return <div className={["rt-collection-state",compact?"rt-collection-state--compact":"",
      className].filter(Boolean).join(" ")} role={loading?"status":undefined}
      aria-live={loading?"polite":undefined}>
    {loading?<LoaderCircle size={25} className="rt-collection-state__spinner" aria-hidden="true"/>:
      icon!=null?<span className="rt-collection-state__icon" aria-hidden="true">{icon}</span>:null}
    {title&&<h3 className="rt-collection-state__title">{title}</h3>}
    <p className="rt-collection-state__message">{message}</p>
    {children}
  </div>;
}
