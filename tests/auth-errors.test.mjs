import {test} from "node:test";
import assert from "node:assert/strict";
import {authErrorMessage} from "../src/features/auth/errors.ts";
test("actionable login cancellation, popup, network and expired session messages",()=>{
  for(const [code,pattern] of [["auth/popup-closed-by-user",/cancelado/],["auth/popup-blocked",/bloqueou/],["auth/network-request-failed",/conexão/],["auth/user-token-expired",/expirou/],["auth/unauthorized-domain",/site do Roteiva/]]) assert.match(authErrorMessage({code}),pattern);
});
