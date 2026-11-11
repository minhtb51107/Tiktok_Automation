import {publicResource} from '../modules/core/scraper/public-discovery';
export interface RequestTelemetry {interceptionEvents:number;admittedRequests:number;blockedRequests:number;handlingFailures:number;coverage:'INTERCEPTION_DECISIONS_NOT_SERVER_RECEIPTS'}
export const newRequestTelemetry=():RequestTelemetry=>({interceptionEvents:0,admittedRequests:0,blockedRequests:0,handlingFailures:0,coverage:'INTERCEPTION_DECISIONS_NOT_SERVER_RECEIPTS'});
/** Preserves existing event-based budgets; rejected resources do not become network admissions. */
export function decidePublicRequest(t:RequestTelemetry,url:string,kind:string,navigations:number,limits:{events:number;navigation:number;blockHeavy:boolean}){
  t.interceptionEvents++;
  const admitted=publicResource(url)&&t.interceptionEvents<=limits.events&&navigations<=limits.navigation&&!(limits.blockHeavy&&['image','media','font'].includes(kind));
  if(admitted)t.admittedRequests++;else t.blockedRequests++;
  return admitted;
}
