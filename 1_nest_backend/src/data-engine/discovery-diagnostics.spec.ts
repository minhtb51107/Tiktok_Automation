import {describe,test,expect} from '@jest/globals';
import {discoveryFailure,inspectSearchPage,inspectPublicDiscovery,extractionStop} from './discovery-diagnostics';
import {ThreadsProvider,ThreadsApiError} from '../threads-api/provider';
import {discoverConversations} from './conversation-public';

describe('Discovery diagnostics — OFFLINE/SYNTHETIC only',()=>{
  test('pilot candidate cap rejects invalid limits before any browser launch',async()=>{
    await expect(discoverConversations('SYNTHETIC',undefined,0)).rejects.toThrow('CONVERSATION_INVALID_LIMIT');
    await expect(discoverConversations('SYNTHETIC',undefined,11)).rejects.toThrow('CONVERSATION_INVALID_LIMIT');
  });
  test.each([
    ['CONVERSATION_RESOURCE_BELOW_384MIB','RESOURCE_GUARD_STOP'],
    ['CONVERSATION_HTTP_429','RATE_LIMIT'],
    ['CONVERSATION_ACCESS_BLOCKED','ACCESS_EMPTY'],
    ['CONVERSATION_HTTP_403','ACCESS_EMPTY'],
    ['CONVERSATION_PARSER_FAILURE','PARSER_FAILURE'],
    ['CONVERSATION_NO_RESULTS','NO_RESULTS'],
    ['CONVERSATION_NO_PUBLIC_CANDIDATES','UNKNOWN'],
    ['CONVERSATION_NAVIGATION_FAILED','UNKNOWN'],
    ['CONVERSATION_EXACT_ROOT_BODY_UNVERIFIED','UNKNOWN'],
  ])('%s is classified without guessing cause',(code,expected)=>expect(discoveryFailure(Error(code))).toBe(expected));
  test('an API 429 is rate limit, an unrecognized error stays unknown',()=>{
    expect(discoveryFailure(new ThreadsApiError('RATE_LIMITED',429))).toBe('RATE_LIMIT');
    expect(discoveryFailure(null)).toBe('UNKNOWN');
  });
  test('empty success is not permission denial or parser failure; no invented paging',()=>{
    expect(inspectSearchPage({data:[]})).toMatchObject({outcome:'ACCESS_EMPTY',count:0,paging:'NOT_PRESENT',publicAccess:'UNKNOWN'});
    expect(inspectSearchPage({data:[],paging:{cursors:{after:'synthetic-cursor'}}}).paging).toBe('CONTINUATION_OBSERVED');
    expect(inspectSearchPage({error:{}}).outcome).toBe('PARSER_FAILURE');
    expect(inspectSearchPage({data:[{id:'SYNTHETIC'}]}).publicAccess).toBe('UNKNOWN');
  });
  test('missing selectors do not prove no results or permission denial',()=>{
    expect(inspectPublicDiscovery({cards:0,permalinkAnchors:0,candidates:0,explicitNoResults:false})).toBe('UNKNOWN');
    expect(inspectPublicDiscovery({cards:0,permalinkAnchors:0,candidates:0,explicitNoResults:true})).toBe('NO_RESULTS');
    expect(inspectPublicDiscovery({cards:1,permalinkAnchors:2,candidates:0,explicitNoResults:false})).toBe('PARSER_FAILURE');
  });
  test('partial extractor metadata cannot hide a memory/access stop or start another browser',()=>{
    expect(extractionStop([{code:'RESOURCE_BELOW_384MIB',message:'stopped'},{code:'PUBLIC_PARTIAL',message:'metadata retained'}])).toBe('CONVERSATION_RESOURCE_BELOW_384MIB');
    expect(extractionStop([{code:'NAVIGATION_ERROR',message:'Public access requires login; no login attempted'}])).toBe('CONVERSATION_ACCESS_BLOCKED');
    expect(extractionStop([{code:'NAVIGATION_ERROR',message:'Navigation HTTP 429'}])).toBe('CONVERSATION_HTTP_429');
    expect(extractionStop([{code:'DOM_UNAVAILABLE',message:'no containers'}])).toBeNull();
  });
  test('TOP/RECENT and KEYWORD/TAG serialize explicitly; reply type is requested, not guessed',async()=>{
    const urls:URL[]=[];
    const provider=new ThreadsProvider((async(u:string)=>{urls.push(new URL(u));return Response.json({data:[]})}) as typeof fetch);
    await provider.search('SYNTHETIC_TOKEN','công việc','TOP',5,null);
    await provider.search('SYNTHETIC_TOKEN','gia đình','RECENT',5,'SYNTHETIC_CURSOR',{},'TAG');
    expect(urls[0].hostname).toBe('graph.threads.com');
    expect(urls[0].pathname).toBe('/v1.0/keyword_search');
    expect(urls[0].searchParams.get('q')).toBe('công việc');
    expect(urls[0].searchParams.get('search_mode')).toBe('KEYWORD');
    expect(urls[0].searchParams.get('fields')?.split(',')).toContain('is_reply');
    expect(urls[0].searchParams.has('access_token')).toBe(false);
    expect(urls[0].searchParams.has('after')).toBe(false);
    expect(urls[1].searchParams.get('search_type')).toBe('RECENT');
    expect(urls[1].searchParams.get('search_mode')).toBe('TAG');
    expect(urls[1].searchParams.get('after')).toBe('SYNTHETIC_CURSOR');
  });
});
