import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefForWorkspaceRoute, parseWorkspacePath, routeFromLocation, sameWorkspaceRoute } from "../src/lib/workspace-routing.ts";

test("Firebase Hosting uses canonical paths for every workspace section",()=>{
  const paths={
    overview:"/",
    projects:"/projetos",
    clients:"/clientes",
    reviews:"/aprovacoes",
    finance:"/financeiro",
    calendar:"/calendario",
    library:"/biblioteca",
    settings:"/configuracoes",
  };
  for(const [view,path] of Object.entries(paths)){
    assert.equal(hrefForWorkspaceRoute({view},{base:"/",useHash:false}),path);
    assert.deepEqual(routeFromLocation({pathname:path,hash:""},{base:"/",useHash:false}),{view});
    assert.deepEqual(parseWorkspacePath(path+"/"),{view});
  }
});

test("project and client detail links remain stable on reload",()=>{
  for(const [route,path] of [
    [{view:"projects",projectId:12345},"/projetos/12345"],
    [{view:"clients",clientId:67890},"/clientes/67890"],
  ]){
    const url=hrefForWorkspaceRoute(route,{base:"/",useHash:false});
    assert.equal(url,path);
    assert.deepEqual(routeFromLocation({pathname:url,hash:""},{base:"/",useHash:false}),route);
  }
});

test("GitHub Pages uses hash routing under its fixed base for F5 and deep links",()=>{
  const env={base:"/roteiva-web/",useHash:true};
  for(const [route,path] of [
    [{view:"projects"},"#/projetos"],
    [{view:"clients",clientId:101},"#/clientes/101"],
    [{view:"settings"},"#/configuracoes"],
    [{view:"overview"},"#/"],
  ]){
    assert.equal(hrefForWorkspaceRoute(route,env),"/roteiva-web/"+path);
    assert.deepEqual(routeFromLocation({pathname:"/roteiva-web/",hash:path},env),route);
  }
  assert.deepEqual(routeFromLocation({pathname:"/roteiva-web/",hash:""},env),{view:"overview"});
  assert.equal(hrefForWorkspaceRoute({view:"calendar"},{base:"/subapp",useHash:false}),"/subapp/calendario");
});

test("invalid, forged or unsupported routes fall back to a safe list or overview",()=>{
  for(const value of ["/projetos/0","/projetos/abc","/projetos/9007199254740992","/projetos/1/segredo"]) {
    const route=parseWorkspacePath(value);
    assert.equal(route.view,value.includes("/segredo")?"overview":"projects");
    assert.equal(route.projectId,undefined);
  }
  assert.deepEqual(parseWorkspacePath("/clientes/abc"),{view:"clients"});
  assert.deepEqual(parseWorkspacePath("/rota-inexistente"),{view:"overview"});
  assert.deepEqual(routeFromLocation({pathname:"/review",hash:""},{base:"/",useHash:false}),{view:"overview"});
  assert.equal(sameWorkspaceRoute({view:"projects"},{view:"projects",projectId:43}),false);
  assert.equal(sameWorkspaceRoute({view:"overview"},{view:"overview"}),true);
});
