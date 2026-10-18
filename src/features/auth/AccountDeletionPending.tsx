import {useEffect,useState} from 'react';
import {AuthLayout} from './AuthLayout';
import {useAuth} from './AuthProvider';
import {fetchAccountDeletionStatus} from '../settings/AccountDeletionAction';

export function AccountDeletionPending(){
  const {logout,busy}=useAuth();
  const [delayed,setDelayed]=useState(false);
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    async function check(){
      try{
        const result=await fetchAccountDeletionStatus();
        if(!active)return;
        if(result.operation?.status==='completed'){
          await logout();
          window.location.replace('/?deletion=completed');
          return;
        }
        setDelayed(result.operation?.status==='manual_review');
        setUnavailable(false);
      }catch{if(active)setUnavailable(true);}
      if(active)timer=setTimeout(()=>void check(),10000);
    }
    void check();
    return ()=>{active=false;clearTimeout(timer);};
  },[logout]);
  return <AuthLayout section="SUA PRIVACIDADE" title="Estamos excluindo sua conta."
    description="Recebemos seu pedido e seu espaço já está fechado para novas alterações. Seus arquivos no Google Drive serão preservados.">
    <p className="auth-invitation" role="status">{delayed
      ?'A exclusão está demorando mais que o esperado. Não é necessário repetir o pedido.'
      :unavailable?'Não conseguimos atualizar o andamento agora. Você pode voltar mais tarde para conferir.'
      :'Você não precisa manter esta página aberta. A exclusão é definitiva.'}</p>
    <button type="button" className="auth-primary" onClick={()=>void logout()} disabled={busy}>Sair da conta</button>
  </AuthLayout>;
}
