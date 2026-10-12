import assert from 'node:assert/strict';
import {normalizeGooglePlace} from '../src/lib/ai/normalize-google-place.ts';
import {resolvePlaceDisplayAddress} from '../src/lib/place-display-address.ts';
import {isDevVerboseLog} from '../src/lib/dev-verbose-log.ts';
const trace=[];const original=console.info;
console.info=(tag,fields)=>{if(tag==='[PLACE_ADDRESS_TRACE]')trace.push(fields)};
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const address='神農路, Nanping Rd, Gushan District, Kaohsiung';
const raw={id:'ChIJPrivateFixture',displayName:{text:'Private fixture'},formattedAddress:address,location:{latitude:22.65,longitude:120.3},primaryType:'cafe'};
try {
 const p=normalizeGooglePlace(raw,{locale:'en'});
 assert.equal(p.address,address);
 const existing=normalizeGooglePlace(raw,{locale:'en',existing:{address:'Existing fixture address'}});
 assert.equal(existing.address,'Existing fixture address');
 assert.equal(resolvePlaceDisplayAddress({formattedAddress:address},{locale:'en'}),address);
 if(isDevVerboseLog()) {
  assert.equal(trace.length,2);
  assert.equal(trace[0].addressOrigin,'formatted_address');assert.equal(trace[0].formattedAddressHasHan,true);
  assert.equal(trace[1].addressOrigin,'existing_address');
  const encoded=JSON.stringify(trace);
  for(const value of [address,raw.id,raw.displayName.text,'22.65','120.3','Existing fixture address']) assert.ok(!encoded.includes(value));
 } else assert.equal(trace.length,0);
} finally {console.info=original}
console.log('PASS address preserved, origin trace privacy, diagnostics enabled='+isDevVerboseLog());
