export function authErrorMessage(error: unknown): string {
  const code = (error as {code?: string})?.code;
  switch (code) {
    case "auth/popup-closed-by-user": case "auth/cancelled-popup-request": return "Login cancelado. Você pode tentar novamente.";
    case "auth/popup-blocked": return "O navegador bloqueou a janela. Permita pop-ups para entrar com Google.";
    case "auth/network-request-failed": return "Sem conexão com o Google. Confira sua internet e tente novamente.";
    case "auth/unauthorized-domain": return "Este endereço não está autorizado para login. Abra o Roteiva DEV.";
    case "auth/user-disabled": case "auth/user-token-expired": case "auth/invalid-user-token": return "Sua sessão expirou ou foi desativada. Entre novamente.";
    case "auth/web-storage-unsupported": case "auth/operation-not-supported-in-this-environment": return "O navegador não permite armazenar a sessão. Abra em um navegador comum, fora do modo restrito.";
    default: return "Não foi possível concluir o acesso. Tente novamente.";
  }
}
