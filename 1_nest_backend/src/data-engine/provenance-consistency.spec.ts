import {describe,it,expect} from '@jest/globals';
import {sourceProvenance,combinedProvenance} from './studio-integration';
const source={sourceUrl:'https://www.threads.com/@test/post/TEST001',sourcePostId:'TEST001',provenance:{synthetic:false,identityEvidence:'DOM_PERMALINK'}};
describe('Source provenance is evidence-based / TEST DATA',()=>{
 it('requires explicit non-synthetic plus verified consistent canonical identity',()=>{
  expect(sourceProvenance(source)).toBe('REAL');
  expect(sourceProvenance({...source,provenance:{synthetic:false,identityEvidence:'UNVERIFIED'}})).toBe('UNKNOWN');
  expect(sourceProvenance({...source,sourcePostId:'OTHER001'})).toBe('UNKNOWN');
 });
 it('never treats missing/false synthetic marker alone as REAL',()=>{
  expect(sourceProvenance(null)).toBe('UNKNOWN');expect(sourceProvenance({})).toBe('UNKNOWN');
  expect(sourceProvenance({...source,provenance:{synthetic:false}})).toBe('UNKNOWN');
 });
 it('preserves SYNTHETIC despite canonical-looking public URLs',()=>{
  expect(sourceProvenance({...source,provenance:{synthetic:true,identityEvidence:'DOM_PERMALINK'}})).toBe('SYNTHETIC');
 });
 it('aggregates empty/mixed source sets as UNKNOWN',()=>{
  expect(combinedProvenance([])).toBe('UNKNOWN');expect(combinedProvenance(['REAL','UNKNOWN'])).toBe('UNKNOWN');
  expect(combinedProvenance(['REAL','SYNTHETIC'])).toBe('UNKNOWN');expect(combinedProvenance(['SYNTHETIC','SYNTHETIC'])).toBe('SYNTHETIC');
 });
});
