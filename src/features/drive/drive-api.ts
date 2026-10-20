import {useCallback} from 'react';
import {useAuth} from '../auth/AuthProvider';
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
export const messages:Record<string,string> = {
  oauth_not_configured:"A integração do Drive ainda não está disponível neste ambiente.",
  reconnect_required:"Sua autorização expirou. Conecte novamente.",
  offline_access_unavailable:"O Google não forneceu acesso contínuo. Revise as permissões do Roteiva na Conta Google e tente novamente.",
  drive_permission_missing:"O acesso solicitado ao Drive não foi autorizado.",
  drive_read_permission_missing:"Para escolher pastas existentes, o Google precisa autorizar a leitura do Drive. Tente conectar novamente e aceite a permissão.",
  invalid_identity:"Entre novamente no Roteiva para continuar.",
  authentication_required:"Entre novamente no Roteiva para continuar.",
  rate_limited:"Muitas solicitações. Aguarde um instante.",
  drive_unavailable:"O Google Drive não respondeu. Tente novamente.",
  google_unavailable:"Não foi possível contatar o Google. Tente novamente em instantes.",
  drive_transport_failed:"A consulta de arquivos ao Google Drive falhou na rede. Tente novamente em instantes.",
  drive_transport_timeout:"O Google Drive demorou demais para responder. Tente novamente.",
  drive_redirect_invalid:"O Google Drive retornou um redirecionamento inválido. A equipe precisa verificar o serviço.",
  drive_redirect_denied:"O Google Drive retornou um redirecionamento não autorizado. A operação foi bloqueada por segurança.",
  google_token_transport_failed:"Não foi possível renovar o acesso pelo serviço de autenticação do Google. Tente novamente em instantes.",
  google_token_timeout:"O serviço de autenticação do Google demorou demais para responder. Tente novamente.",
  google_token_upstream_failed:"O serviço de autenticação do Google retornou uma resposta inesperada. A equipe precisa verificar a integração.",
  google_token_redirect_blocked:"A autenticação do Google retornou um redirecionamento não esperado. A solicitação foi interrompida para proteger sua conta.",
  google_temporarily_unavailable:"O Google está temporariamente indisponível. Tente novamente em instantes.",
  google_oauth_client_invalid:"A autorização Google do Roteiva precisa de correção no servidor. Seus vínculos foram preservados.",
  google_oauth_request_invalid:"O servidor do Roteiva não conseguiu renovar a autorização Google. A equipe precisa revisar a configuração.",
  google_oauth_rejected:"O Google recusou a renovação da conexão. A configuração precisa ser verificada antes de tentar novamente.",
  token_refresh_retry_later:"A conexão com o Google está temporariamente ocupada. Aguarde alguns segundos e tente novamente.",
  token_refresh_busy:"A conexão com o Google está processando outra solicitação. Aguarde alguns segundos.",
  google_rate_limited:"O Google limitou temporariamente as solicitações. Aguarde e tente novamente.",
  drive_folder_not_found:"Pasta indisponível ou sem permissão.",
  invalid_google_response:"Não foi possível interpretar os dados do Drive.",
  connection_changed:"A conexão foi alterada. Atualize para continuar.",
  invalid_upload:"Arquivo inválido ou não suportado.",
  upload_folder_not_linked:"Esta pasta não está mais vinculada ao projeto.",
  upload_project_denied:"Você não possui autorização para enviar arquivos neste projeto.",
  folder_authorization_unavailable:"Não foi possível confirmar o vínculo da pasta. Tente novamente.",
  drive_upload_permission_missing:"O Google não autorizou gravação nesta pasta. Autorize-a para o Roteiva.",
  drive_upload_unavailable:"O Google Drive não conseguiu iniciar este envio.",
  drive_upload_rejected:"O Google Drive rejeitou os dados deste arquivo.",
  drive_storage_full:"Seu Google Drive está sem espaço disponível para receber o arquivo.",
  drive_rate_limited:"O Google Drive limitou temporariamente novos envios.",
  drive_upload_transport_failed:"Não foi possível iniciar o envio. Verifique sua conexão.",
  upload_session_invalid:"O Google retornou uma sessão inválida.",
  drive_upload_not_confirmed:"O Google ainda não confirmou este arquivo.",
  drive_picker_required:"Autorize a pasta no Google para enviar os arquivos.",
  picker_not_configured:"A autorização de pastas precisa ser configurada pela equipe. Seus arquivos não foram enviados.",
  picker_account_mismatch:"Use a mesma conta Google da conexão escolhida no Roteiva.",
  picker_scope_mismatch:"O Google devolveu permissões inesperadas. A autorização foi bloqueada.",
  invalid_picker_token:"A autorização Google expirou. Tente autorizar a pasta novamente.",
  upload_attempt_mismatch:"A confirmação não corresponde a este envio.",
  upload_attempt_uncertain:"O início do envio ficou sem confirmação. Confira a pasta antes de selecionar o arquivo novamente.",
  upload_attempt_expired:"A tentativa de envio expirou. Confira a pasta antes de iniciar outro envio.",
  upload_authorization_too_complex:"Não foi possível verificar esta pasta nesta solicitação. Vincule uma pasta mais próxima do destino e tente novamente.",
  connection_failed:"Não foi possível concluir a conexão. Tente novamente.",
  review_invalid_input:"Confira os dados da solicitação e os arquivos selecionados.",
  review_project_denied:"O cliente ou projeto não está mais disponível para esta aprovação.",
  review_folder_denied:"A pasta não está mais vinculada a este projeto.",
  review_file_denied:"O arquivo não está autorizado para compartilhamento nesta pasta. Confira o Drive.",
  review_drive_grant_required:"Reconecte o Google Drive com permissão de gerenciamento dos arquivos selecionados.",
  review_drive_share_denied:"O Google Drive não permitiu compartilhar este arquivo. Verifique as políticas e permissões da conta.",
  review_drive_unavailable:"O Google Drive não conseguiu concluir o compartilhamento agora. Tente novamente.",
  review_existing_public_permission:"Este arquivo já tem permissões incompatíveis com o acesso escolhido. Revise o compartilhamento no Drive antes de continuar.",
  review_recipient_denied:"Esta conta Google não está autorizada para esta revisão.",
  review_busy:"Uma alteração de acesso está em andamento. Recarregue e tente novamente.",
  review_file_in_use:"Este arquivo já está em outra aprovação ativa. Encerre o compartilhamento anterior ou escolha outro arquivo.",
  review_invalid_state:"Esta ação não está disponível no estado atual da aprovação.",
  review_expired:"O prazo desta revisão terminou. Crie uma nova solicitação.",
  review_not_found:"A aprovação não está mais disponível.",
  review_close_before_disconnect:"Existem aprovações ativas neste Drive. Encerre-as antes de desconectar, para revogar os links com segurança.",
  review_permission_list_too_large:"Existem muitas permissões neste arquivo; revise o compartilhamento diretamente no Drive antes de continuar.",
  review_firestore_unavailable:"Não foi possível confirmar o projeto e a pasta. Tente novamente.",
};
export function useDriveApi(){
  const {user}=useAuth();
  const call=useCallback(async <T,>(path:string,method:"GET"|"POST"="GET",payload?:unknown,signal?:AbortSignal):Promise<T>=>{
    if(!user)throw new Error("Entre novamente no Roteiva.");
    let response:Response|undefined;
    for(let i=0;i<2;i++){
      const token=await user.getIdToken(i===1);
      response=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,...(payload!==undefined?{"Content-Type":"application/json"}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),cache:"no-store",signal});
      if(response.status!==401)break;
    }
    if(!response?.ok){
      const payload=await response?.json().catch(()=>({})) as {error?:{code?:string}}|undefined;
      const code=payload?.error?.code||"service_unavailable";
      throw Object.assign(new Error(messages[code]||"Não foi possível concluir a operação."),{code});
    }
    return response.json() as Promise<T>;
  },[user]);

  return call;
}
