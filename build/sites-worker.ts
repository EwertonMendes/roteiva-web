import handler from "vinext/server/fetch-handler";

// Adaptador de renderização do frontend Next/Vinext.
// Não contém API de negócio, acesso a banco nem storage.
export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return handler.fetch(request, env, ctx);
  },
};
