const crypto = require('node:crypto');

const providers = {
  google_workspace: {
    clientId: () => process.env.GOOGLE_CLIENT_ID, clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
  },
  microsoft_365: {
    clientId: () => process.env.MICROSOFT_CLIENT_ID, clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access Calendars.ReadBasic User.Read',
  },
};

function config(provider) { const item=providers[provider]; if(!item)throw new Error('Unsupported OAuth provider.');if(!item.clientId()||!item.clientSecret())throw new Error(`${provider} OAuth credentials are not configured.`);return item; }
function authorizationUrl(provider,{redirectUri,state}) { const p=config(provider);const url=new URL(p.authorize);url.search=new URLSearchParams({client_id:p.clientId(),redirect_uri:redirectUri,response_type:'code',scope:p.scope,state,access_type:'offline',prompt:'consent'});return url.toString(); }
function requestSignal(deadlineAt,externalSignal){const perRequest=Number(process.env.UNMEET_PROVIDER_TIMEOUT_MS||15000);const remaining=deadlineAt?deadlineAt-Date.now():perRequest;if(remaining<=0)throw new Error('Calendar synchronization deadline exceeded.');const timeout=AbortSignal.timeout(Math.max(1,Math.min(perRequest,remaining)));return externalSignal?AbortSignal.any([externalSignal,timeout]):timeout;}
async function exchange(provider,{code,redirectUri}) { const p=config(provider);const response=await fetch(p.token,{method:'POST',signal:requestSignal(),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:p.clientId(),client_secret:p.clientSecret(),code,redirect_uri:redirectUri,grant_type:'authorization_code'})});const data=await response.json();if(!response.ok)throw new Error(data.error_description||'OAuth authorization failed.');return data; }
async function refresh(provider,token,{deadlineAt,signal}={}) { const p=config(provider);const response=await fetch(p.token,{method:'POST',signal:requestSignal(deadlineAt,signal),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:p.clientId(),client_secret:p.clientSecret(),refresh_token:token.refresh_token,grant_type:'refresh_token',scope:p.scope})});const data=await response.json();if(!response.ok)throw new Error(data.error_description||'OAuth refresh failed.');return {...token,...data,refresh_token:data.refresh_token||token.refresh_token}; }
function tokenExpired(token){return !token.obtained_at||Date.now()>=Number(token.obtained_at)+(Number(token.expires_in||3600)-120)*1000;}
async function revoke(provider,token){if(provider!=='google_workspace')return{revoked:false,reason:'provider_does_not_offer_scoped_revocation'};const value=token.refresh_token||token.access_token;if(!value)return{revoked:false,reason:'no_token'};const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',signal:requestSignal(),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:value})});return response.ok?{revoked:true}:{revoked:false,reason:`provider_${response.status}`};}

function occurrence(item,provider){
  if(item.status==='cancelled'||item.isCancelled||item.start?.date||item.end?.date)return null;
  const start=item.start?.dateTime||item.start?.date||item.start?.dateTimeTimeZone||item.start?.dateTime;
  const end=item.end?.dateTime||item.end?.date;
  const startMs=Date.parse(start);const endMs=Date.parse(end);if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)return null;
  const attendees=(item.attendees||[]).filter(a=>a.responseStatus!=='declined'&&a.status?.response!=='declined');
  const owner=item.organizer?.email||item.organizer?.emailAddress?.address||'';
  return { id:item.recurringEventId||item.seriesMasterId||item.iCalUID||item.id,title:item.summary||item.subject||'Untitled meeting',owner:item.organizer?.displayName||item.organizer?.emailAddress?.name||owner,ownerEmail:owner,team:'Calendar',durationMinutes:Math.round((endMs-startMs)/60000),attendeeCount:Math.max(1,attendees.length+1),start:new Date(startMs).toISOString(),hasAgenda:Boolean(item.description||item.bodyPreview),provider };
}
function group(items,provider){const groups=new Map();for(const raw of items){const item=occurrence(raw,provider);if(!item)continue;const key=item.id||`${item.title}|${item.ownerEmail}`;const g=groups.get(key)||{...item,count:0,totalDuration:0,totalAttendees:0,first:item.start};g.count++;g.totalDuration+=item.durationMinutes;g.totalAttendees+=item.attendeeCount;if(item.start<g.first)g.first=item.start;groups.set(key,g);}return [...groups.values()].map(g=>({id:g.id,title:g.title,owner:g.owner||g.ownerEmail||'Unknown',ownerEmail:g.ownerEmail,team:g.team,durationMinutes:Math.round(g.totalDuration/g.count),attendeeCount:Math.max(1,Math.round(g.totalAttendees/g.count)),occurrencesPerMonth:Number(g.count.toFixed(2)),hasAgenda:g.hasAgenda,ageMonths:Math.max(0,Math.round((Date.now()-Date.parse(g.first))/(30.44*86400000))),reviewStatus:'backlog'}));}
async function fetchEvents(provider,token,{from,to,deadlineAt,signal}) { const headers={Authorization:`Bearer ${token.access_token}`};const allowedHost=provider==='google_workspace'?'www.googleapis.com':'graph.microsoft.com';let url;if(provider==='google_workspace'){url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');url.search=new URLSearchParams({timeMin:from,timeMax:to,singleEvents:'true',maxResults:'2500',orderBy:'startTime'});}else{url=new URL('https://graph.microsoft.com/v1.0/me/calendarView');url.search=new URLSearchParams({startDateTime:from,endDateTime:to,'$top':'1000','$select':'id,seriesMasterId,iCalUId,subject,start,end,organizer,attendees,bodyPreview'});}const items=[];for(let page=0;url&&page<20;page++){if(url.protocol!=='https:'||url.hostname!==allowedHost)throw new Error('Calendar pagination returned an unexpected destination.');const response=await fetch(url,{headers,signal:requestSignal(deadlineAt,signal)});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Calendar sync failed.');items.push(...(data.items||data.value||[]));const next=data.nextPageToken?`${url.origin}${url.pathname}?${new URLSearchParams({...Object.fromEntries(url.searchParams),pageToken:data.nextPageToken})}`:data['@odata.nextLink'];url=next?new URL(next):null;}return group(items,provider);}
function stateToken(){return crypto.randomBytes(32).toString('base64url');}
module.exports={providers,authorizationUrl,exchange,refresh,revoke,tokenExpired,fetchEvents,group,stateToken};
