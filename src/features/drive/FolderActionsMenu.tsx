import {MoreHorizontal} from "lucide-react";
import {AppDropdownMenu} from "../ui/AppDropdownMenu";

type Props={
 name:string;
 onOpen:()=>void;
 onUnlink:()=>void;
 disabled?:boolean;
};
/** Domain-specific folder actions compose the shared dropdown primitive. */
export function FolderActionsMenu({name,onOpen,onUnlink,disabled=false}:Props){
 return <AppDropdownMenu label={'Opções da pasta '+name} icon={<MoreHorizontal size={18}/>}
  className="rl-folder-actions-trigger" menuClassName="rl-menu-items rl-folder-actions-popup"
  disabled={disabled} items={[
    {label:"Abrir pasta",onSelect:onOpen},
    {label:"Desvincular do projeto",onSelect:onUnlink}
  ]}/>;
}
