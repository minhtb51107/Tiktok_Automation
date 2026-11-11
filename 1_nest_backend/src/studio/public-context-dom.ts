/** Self-contained public DOM observation. No order/author/topic/distance parent heuristic. */
export function observePublicContext() {
  const canonical=(value:string)=>{try{const u=new URL(value,location.origin);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)&&/^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(u.pathname)?'https://www.threads.com'+u.pathname.replace(/\/$/,''):null}catch{return null}};
  const target=canonical(location.href),regions:Array<{kind:'DISCUSSION_REGION'|'RECOMMENDATION_REGION';documentUrl:string;targetUrl:string;subjectUrl:string;label:string;pointer:string}>=[],replies:Array<{subjectUrl:string;parentUrl:string;documentUrl:string;authorUrl:string;bodyText:string;pointer:string;label:string;subjectTimePermalink:string;headerScoped:true}>=[];
  if(!target)return {regions,replies};
  const cards=[...document.querySelectorAll('div[data-pressable-container="true"],article')].filter(c=>{const b=c.getBoundingClientRect();return b.width>0&&b.height>0}).slice(0,80);
  cards.forEach((card,index)=>{
    const owns=(el:Element)=>el.closest('div[data-pressable-container="true"],article')===card;
    const times=[...new Set([...card.querySelectorAll('time')].filter(owns).map(t=>canonical(t.closest('a[href]')?.getAttribute('href')||'')).filter(Boolean))];
    const all=[...new Set([...card.querySelectorAll('a[href]')].filter(owns).map(a=>canonical(a.getAttribute('href')||'')).filter(Boolean))];
    const subject=times.length===1?times[0]:all.length===1?all[0]:null;
    if(!subject||subject===target)return;
    for(let region=card.parentElement;region&&region!==document.body;region=region.parentElement){
      if(!region.matches('section,[role="region"]'))continue;
      const label=(region.getAttribute('aria-label')||(region.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')).trim();
      const recommended=/^(suggested posts|related posts|more posts|bài viết (đề xuất|liên quan|khác))$/iu.test(label);
      const discussion=/^(replies|comments|discussion|bình luận|trả lời|cuộc thảo luận)$/iu.test(label)&&[...region.querySelectorAll('a[href]')].some(a=>canonical(a.getAttribute('href')||'')===target);
      if(recommended||discussion){regions.push({kind:recommended?'RECOMMENDATION_REGION':'DISCUSSION_REGION',documentUrl:target,targetUrl:target,subjectUrl:subject,label,pointer:`/dom/card/${index}/labelled-region`});break;}
    }
    // A body link saying "Replying to" is NOT UI evidence. Require the card's header.
    if(times.length!==1)return;
    const targets=[...card.querySelectorAll('header a[href],[data-testid="reply-context"] a[href],[data-testid="replying-to"] a[href]')].filter(a=>owns(a)&&/^(replying to|đang trả lời)(?:\s+@[\w.-]+)?$/iu.test((a.getAttribute('aria-label')||a.textContent||'').trim()));
    if(targets.length!==1)return;
    const parent=canonical(targets[0].getAttribute('href')||'');if(!parent||parent===subject)return;
    const handle=subject.split('/')[3];
    const author=[...card.querySelectorAll('header a[href],a[rel="author"]')].filter(owns).map(a=>{try{const u=new URL(a.getAttribute('href')||'',location.origin);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)&&u.pathname.replace(/\/$/,'')==='/'+handle?'https://www.threads.com/'+handle:null}catch{return null}}).find(Boolean);
    if(!author)return;
    const text=[...card.querySelectorAll('span[dir="auto"]')].filter(s=>owns(s)&&!s.closest('header,time,button,[role="button"],[data-testid="reply-context"],[data-testid="replying-to"]')&&!s.parentElement?.closest('span[dir="auto"]')).map(s=>s.textContent||'').filter(Boolean).join('\n');
    if(text.trim())replies.push({subjectUrl:subject,parentUrl:parent,documentUrl:target,authorUrl:author,bodyText:text,pointer:`/dom/card/${index}/header/reply-link`,label:(targets[0].getAttribute('aria-label')||targets[0].textContent||'').trim(),subjectTimePermalink:subject,headerScoped:true});
  });
  return {regions,replies};
}
