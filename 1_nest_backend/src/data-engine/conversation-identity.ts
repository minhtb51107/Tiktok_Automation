/** Shared browser-safe canonical identity; no author/shortcode substitution. */
export function canonicalPost(value: unknown) {
  if(typeof value!=='string')return null;
  try{const u=new URL(value),m=u.pathname.match(/^\/@([\w.-]+)\/post\/([\w-]+)\/?$/);
    if(u.protocol!=='https:'||!['www.threads.com','threads.com','www.threads.net','threads.net'].includes(u.hostname)||u.port||u.username||u.password||!m)return null;
    return {id:m[2],handle:m[1],url:`https://www.threads.com/@${m[1]}/post/${m[2]}`};
  }catch{return null}
}
