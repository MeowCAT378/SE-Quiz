"""Isolated HTTP/WebSocket authorization regression and callback benchmark; no live data."""
import queue, sys
import base64, concurrent.futures, hashlib, hmac, http.server, json, os, socket, struct, subprocess, threading, time, urllib.request, urllib.error, uuid
KEY=b'isolated-runtime-test-key'; PORT=18081; CALLBACK=18082
versions={}; games={}; owners={}; open_sockets=[]; unavailable=False; delay=0; calls=0
now=lambda:int(time.time()*1000)
def mac(domain,data): return hmac.new(KEY,('seopen:'+domain+':v1\n'+data).encode(),hashlib.sha256).hexdigest()
def token(grant):
 payload=base64.urlsafe_b64encode(json.dumps(grant,separators=(',',':')).encode()).decode().rstrip('='); return payload+'.'+mac('grant',payload)
def proof(path,body):
 stamp=now(); return str(stamp)+'.'+mac('service','POST\n'+path+'\n'+hashlib.sha256(body).hexdigest()+'\n'+str(stamp))
class CallbackServer(http.server.ThreadingHTTPServer):
 request_queue_size=128
class Callback(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  global calls
  body=self.rfile.read(int(self.headers['Content-Length'])); status=403; result={}
  try:
   stamp,sig=self.headers['X-SEOpen-Service-Proof'].split('.')
   assert abs(now()-int(stamp))<=30000 and hmac.compare_digest(sig,mac('service','POST\n'+self.path+'\n'+hashlib.sha256(body).hexdigest()+'\n'+stamp))
   if self.path=='/api/host/completed':
    value=json.loads(body);room=games[value['instanceId']]
    assert value['ownerId']==owners[value['instanceId']] and value['gameCode']==room['game_id'] and value['watcherId']==room['watcher_id']
    room['ended']=True; self.send_response(200);self.end_headers();self.wfile.write(b'{}');return
   request=json.loads(body); payload,sig=request['grant'].split('.'); assert hmac.compare_digest(sig,mac('grant',payload))
   grant=json.loads(base64.urlsafe_b64decode(payload+'='*((4-len(payload)%4)%4))); calls+=1
   if delay: time.sleep(delay)
   assert not unavailable and versions.get(grant['userId'])==grant['sessionVersion'] and grant['expiresAt']>now()
   assert request['purpose']==grant['purpose'] and request['instanceId']==grant['instanceId']
   if grant['purpose']=='host-game':
    game=games[grant['instanceId']]; assert not game.get('ended'); assert game['game_id']==request['gameCode']==grant['gameCode'] and game['watcher_id']==request['watcherId']==grant['watcherId']
   result={k:v for k,v in grant.items() if k!='issuedAt'}; result['authorized']=True;status=200
  except Exception: pass
  try:
   self.send_response(status);self.end_headers();self.wfile.write(json.dumps(result).encode())
  except (BrokenPipeError,ConnectionResetError): pass

def request(path,body=None,bearer=None,signed=False):
 data=None if body is None else json.dumps(body,separators=(',',':')).encode();headers={'Content-Type':'application/json'}
 if bearer: headers['Authorization']='Bearer '+bearer
 if signed: headers['X-SEOpen-Service-Proof']=proof(path,data)
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(PORT)+path,data=data,headers=headers),timeout=5) as r: return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
class WS:
 def __init__(self,code,watcher='new'):
  open_sockets.append(self)
  self.s=socket.create_connection(('127.0.0.1',PORT),timeout=3);self.buffer=b'';self.closed=False
  key=base64.b64encode(os.urandom(16)).decode();self.s.sendall(f'GET /watch/{code}/{watcher} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n'.encode())
  while b'\r\n\r\n' not in self.buffer:self.buffer+=self.s.recv(4096)
  header,self.buffer=self.buffer.split(b'\r\n\r\n',1);assert b'101' in header,header
  self.messages=queue.Queue()
  def reader():
   try:
    while not self.closed:self.messages.put(self._recv(60))
   except Exception as error:self.messages.put(error)
  threading.Thread(target=reader,daemon=True).start()
 def send(self,value,op=1):
  raw=json.dumps(value).encode() if op==1 else value; mask=os.urandom(4);n=len(raw)
  header=bytes([128|op,128|n]) if n<126 else bytes([128|op,254])+struct.pack('!H',n)
  self.s.sendall(header+mask+bytes(b^mask[i%4] for i,b in enumerate(raw)))
 def read(self,n):
  while len(self.buffer)<n:
   part=self.s.recv(65536)
   if not part: self.closed=True; raise EOFError()
   self.buffer+=part
  result,self.buffer=self.buffer[:n],self.buffer[n:];return result
 def _recv(self,timeout=3):
  self.s.settimeout(timeout)
  while True:
   first,second=self.read(2);n=second&127
   if n==126:n=struct.unpack('!H',self.read(2))[0]
   elif n==127:n=struct.unpack('!Q',self.read(8))[0]
   raw=self.read(n);op=first&15
   if op==9:self.send(raw,10);continue
   if op==8:self.closed=True;return {'closed':True}
   if op==1:return json.loads(raw)
 def recv(self,timeout=3):
  try:value=self.messages.get(timeout=timeout)
  except queue.Empty:raise TimeoutError('WebSocket timeout')
  if isinstance(value,Exception):raise value
  return value
 def until(self,predicate,timeout=3):
  end=time.monotonic()+timeout
  while time.monotonic()<end:
   value=self.recv(max(.01,end-time.monotonic()))
   if predicate(value):return value
  raise AssertionError('message missing')
 def close(self):
  try:self.s.shutdown(socket.SHUT_RDWR)
  except OSError:pass
  self.s.close()

def create(owner=None,instance=None,slides=None):
 owner=owner or str(uuid.uuid4());versions.setdefault(owner,0); instance=instance or str(uuid.uuid4())
 grant={'purpose':'create-game','userId':owner,'sessionVersion':versions[owner],'issuedAt':now(),'expiresAt':now()+60000,'instanceId':instance}
 body={'config':{'title':'transport security','slides':slides or []},'options':{'random_names':None,'show_answers':True,'no_leaderboard':False,'teams':None}}
 status,raw=request('/add',body,token(grant));assert status==200,(status,raw)
 game=json.loads(raw);games[instance]=game;owners[instance]=owner;return owner,grant,body,game

def host(owner,game,version=None,expiry=300000):
 grant={'purpose':'host-game','userId':owner,'sessionVersion':versions[owner] if version is None else version,'issuedAt':now(),'expiresAt':now()+expiry,'instanceId':game['instance_id'],'gameCode':game['game_id'],'watcherId':game['watcher_id']}
 ws=WS(game['game_id'],game['watcher_id']);ws.send({'Authorization':token(grant)});ws.send({'Ghost':{'ClaimId':game['watcher_id']}});return ws,grant

def main():
 global unavailable,delay
 callback=CallbackServer(('127.0.0.1',CALLBACK),Callback);threading.Thread(target=callback.serve_forever,daemon=True).start()
 env={**os.environ,'FUIZ_PORT':str(PORT),'FUIZ_HOSTNAME':'127.0.0.1','ADMIN_SESSION_SECRET':KEY.decode(),'HOST_AUTHORIZATION_URL':f'http://127.0.0.1:{CALLBACK}/api/host/authorize'}
 log=open('/tmp/seopen-runtime-test.log','w');runtime=subprocess.Popen(['/app/target/debug/fuiz-server'],env=env,stdout=log,stderr=log)
 try:
  for _ in range(100):
   try:
    if request('/hello')[0]==200:break
   except Exception:time.sleep(.1)
  if '--timeout-fast' in sys.argv:
   timeout_cases();return
  owner,grant,body,game=create();assert request('/add',body)[0]==401
  assert request('/add',body,token({**grant,'userId':'forged'}))[0]==401
  assert request('/internal/host/revoke',{'userId':owner,'minSessionVersion':1})[0]==401
  with concurrent.futures.ThreadPoolExecutor(8) as pool:
   results=list(pool.map(lambda _:request('/add',body,token(grant)),range(16)))
  assert all(json.loads(raw)==game for status,raw in results if status==200) and all(status==200 for status,_ in results)
  unknown=str(uuid.uuid4());assert request('/internal/host/games/remove',{'instanceId':unknown},signed=True)[0]==204
  cancelled={**grant,'instanceId':unknown};assert request('/add',body,token(cancelled))[0]==409
  delayed={**grant,'instanceId':str(uuid.uuid4())};delay=.3;before=calls
  with concurrent.futures.ThreadPoolExecutor(1) as pool:
   creation=pool.submit(request,'/add',body,token(delayed))
   while calls==before:time.sleep(.005)
   assert request('/internal/host/games/remove',{'instanceId':delayed['instanceId']},signed=True)[0]==204
   assert creation.result()[0]==409
  delay=0
  assert request('/add',body,token({**grant,'issuedAt':now()-60000,'expiresAt':now()-1}))[0]==401
  legit,hgrant=host(owner,game);legit.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game'])
  attacker=WS(game['game_id'],game['watcher_id']);attacker.send({'Ghost':{'ClaimId':game['watcher_id']}});assert attacker.until(lambda m:'closed'in m)['closed']
  _,_,_,other=create();cross=WS(other['game_id']);cross.send({'Ghost':{'ClaimId':game['watcher_id']}});assert cross.until(lambda m:'closed'in m)['closed']
  legit.send({'Host':'RequestTeamRosters'});legit.until(lambda m:'Game'in m and 'TeamRosters'in m['Game'])
  participant=WS(game['game_id']);participant.send({'Ghost':'DemandId'});assigned=participant.until(lambda m:'Game'in m and 'IdAssign'in m['Game'])['Game']['IdAssign'];participant.send({'Unassigned':{'NameRequest':'anonymous'}});participant.until(lambda m:'Game'in m and 'NameAssign'in m['Game'])
  participant.send({'Host':'RequestTeamRosters'});assert participant.until(lambda m:'closed'in m)['closed']
  replacement,_=host(owner,game);replacement.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);legit.until(lambda m:'closed'in m)
  time.sleep(.1);replacement.send({'Host':'RequestTeamRosters'});replacement.until(lambda m:'Game'in m and 'TeamRosters'in m['Game'])
  # Refusal must reach the browser before the close frame, for fresh and unknown IDs.
  replacement.send({'Host':{'Lock':True}})
  replacement.send({'Host':'RequestTeamRosters'});replacement.until(lambda m:'Game'in m and 'TeamRosters'in m['Game'])
  for claim in [{'Ghost':'DemandId'},{'Ghost':{'ClaimId':str(uuid.uuid4())}}]:
   refused=WS(game['game_id']);refused.send(claim)
   refusal=refused.until(lambda m:'CannotJoin'in m.get('Game',{}) or 'closed'in m)
   assert refusal=={'Game':{'CannotJoin':'Locked'}},refusal
   assert refused.until(lambda m:'closed'in m)['closed']
  replacement.send({'Host':{'Lock':False}})
  replacement.send({'Authorization':token({**hgrant,'userId':'other'})});replacement.until(lambda m:'closed'in m)
  # Immediate version notification does not destroy participant-accessible game.
  active,_=host(owner,game);active.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);versions[owner]+=1
  started=time.monotonic();assert request('/internal/host/revoke',{'userId':owner,'minSessionVersion':versions[owner]},signed=True)[0]==204;active.until(lambda m:'closed'in m);immediate=(time.monotonic()-started)*1000
  assert request('/alive/'+game['game_id'])[1]==b'true'
  idle,_=host(owner,game);idle.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);versions[owner]+=1;started=time.monotonic();idle.until(lambda m:'closed'in m,6.5);fallback=(time.monotonic()-started)*1000;assert fallback<=6200,fallback
  pending,_=host(owner,game);pending.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);delay=.3;before=calls;pending.send({'Host':'RequestTeamRosters'})
  while calls==before:time.sleep(.005)
  during=WS(game['game_id']);during.send({'Ghost':'DemandId'});during.until(lambda m:'Game'in m and 'IdAssign'in m['Game']);during.send({'Unassigned':{'NameRequest':'during-check'}});during.until(lambda m:'Game'in m and 'NameAssign'in m['Game']);assert not any(isinstance(m,dict) and (m.get('Game',{}).get('PlayerJoined') or {}).get('name')=='during-check' for m in list(pending.messages.queue)),'pending check leaked data'
  pending.until(lambda m:'Game'in m and (m['Game'].get('PlayerJoined') or {}).get('name')=='during-check');pending.until(lambda m:'Game'in m and 'TeamRosters'in m['Game']);delay=0
  versions[owner]+=1;pending.send({'Host':'RequestTeamRosters'});pending.until(lambda m:'closed'in m)
  outage,_=host(owner,game);outage.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);unavailable=True;outage.send({'Host':'RequestTeamRosters'});assert outage.until(lambda m:'closed'in m)['closed'];unavailable=False
  timeout,_=host(owner,game);timeout.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);delay=2;started=time.monotonic();timeout.send({'Host':'RequestTeamRosters'});timeout.until(lambda m:'closed'in m);bounded=(time.monotonic()-started)*1000;assert bounded<1250,bounded;delay=0
  timer_owner,_,_,timer_game=create(slides=[{'InfoSlide':{'title':'first','duration':5000}},{'InfoSlide':{'title':'after revocation','duration':None}}])
  timer_host,_=host(timer_owner,timer_game);timer_host.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);timer_player=WS(timer_game['game_id']);timer_player.send({'Ghost':'DemandId'});timer_player.until(lambda m:'Game'in m and 'IdAssign'in m['Game']);timer_player.send({'Unassigned':{'NameRequest':'timer-player'}});timer_player.until(lambda m:'Game'in m and 'NameAssign'in m['Game']);timer_host.send({'Host':{'Next':'Lobby'}});timer_player.until(lambda m:m.get('InfoSlide',{}).get('ContentAnnouncement',{}).get('title')=='first')
  versions[timer_owner]+=1;request('/internal/host/revoke',{'userId':timer_owner,'minSessionVersion':1},signed=True);timer_host.until(lambda m:'closed'in m);timer_player.until(lambda m:m.get('InfoSlide',{}).get('ContentAnnouncement',{}).get('title')=='after revocation',6.5)
  poll_owner,_,_,poll_game=create(slides=[{'Poll':{'title':'anonymous answer','introduce_slide':0,'introduce_question':0,'time_limit':5000,'points_awarded':0,'answers':[{'Text':'yes'},{'Text':'no'}]}}])
  poll_host,_=host(poll_owner,poll_game);poll_host.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);poll_player=WS(poll_game['game_id']);poll_player.send({'Ghost':'DemandId'});poll_player.until(lambda m:'Game'in m and 'IdAssign'in m['Game']);poll_player.send({'Unassigned':{'NameRequest':'voter'}});poll_player.until(lambda m:'Game'in m and 'NameAssign'in m['Game']);poll_host.send({'Host':{'Next':'Lobby'}});poll_player.until(lambda m:'AnswersAnnouncement'in m.get('Poll',{}))
  versions[poll_owner]+=1;request('/internal/host/revoke',{'userId':poll_owner,'minSessionVersion':1},signed=True);poll_host.until(lambda m:'closed'in m);poll_player.send({'Player':{'IndexAnswer':0}});result=poll_player.until(lambda m:'AnswersResults'in m.get('Poll',{}));assert result['Poll']['AnswersResults']['results']=={'counts':[1,0],'total_count':1}
  stats=[]
  for concurrency in (1,10,30):
   sockets=[]
   for _ in range(concurrency):
    who,_,_,room=create();ws,_=host(who,room);ws.until(lambda m:'Game'in m and 'WaitingScreen'in m['Game']);sockets.append(ws)
   def commands(ws):
    times=[]
    for _ in range(10):
     start=time.monotonic();ws.send({'Host':'RequestTeamRosters'});ws.until(lambda m:'Game'in m and 'TeamRosters'in m['Game']);times.append((time.monotonic()-start)*1000)
    return times
   start=time.monotonic()
   with concurrent.futures.ThreadPoolExecutor(concurrency) as pool:latencies=sorted(sum(pool.map(commands,sockets),[]))
   elapsed=time.monotonic()-start;stats.append({'concurrency':concurrency,'count':len(latencies),'p50_ms':latencies[len(latencies)//2],'p95_ms':latencies[int(len(latencies)*.95)-1],'max_ms':max(latencies),'commands_per_second':len(latencies)/elapsed,'failures':0})
   for ws in sockets:ws.close()
  print(json.dumps({'passed':'HTTP/WS authorization, replay/cancellation, cross-game claim, anonymous name, takeover race, renewal denial, revoke, idle fallback and provider outage','immediate_ms':immediate,'fallback_ms':fallback,'callback_timeout_ms':bounded,'callbacks':calls,'benchmarks':stats},indent=2))
 finally:
  unavailable=False;delay=0
  for instance,room in games.items():
   if request('/alive/'+room['game_id'])[1]==b'true':
    cleanup,_=host(owners[instance],room);cleanup.until(lambda m:'WaitingScreen'in m.get('Game',{}) or 'InfoSlide'in m or 'Poll'in m)
    cleanup.send({'Host':'End'});cleanup.until(lambda m:'Summary'in m.get('Game',{}))
   assert request('/alive/'+room['game_id'])[1]==b'false',room['game_id']
   deadline=time.time()+5
   while not room.get('ended') and time.time()<deadline:time.sleep(.05)
   assert room.get('ended'),room['game_id']
  print(json.dumps({'cleanup_games':len(games),'ended_bindings':sum(bool(g.get('ended')) for g in games.values())}))
  for ws in open_sockets:
   try:ws.close()
   except Exception:pass
  runtime.kill();runtime.wait(timeout=5);callback.shutdown();log.close()

def timeout_cases():
 def room():
  owner,_,_,game=create(slides=[{'InfoSlide':{'title':'host paced','duration':None}}])
  h,_=host(owner,game);h.until(lambda m:'WaitingScreen'in m.get('Game',{}));h.until(lambda m:m.get('Game',{}).get('HostTimeout',{}).get('remaining_ms')==6000)
  p=WS(game['game_id']);p.send({'Ghost':'DemandId'});p.until(lambda m:'IdAssign'in m.get('Game',{}));p.send({'Unassigned':{'NameRequest':'timeout-player'}});p.until(lambda m:'NameAssign'in m.get('Game',{}))
  return owner,game,h,p
 # Authorized manual End and one exact summary for both roles.
 _,game,h,p=room();bad=WS(game['game_id']);bad.send({'Host':'End'});bad.until(lambda m:'closed'in m);assert request('/alive/'+game['game_id'])[1]==b'true';h.send({'Host':'End'});h.until(lambda m:'Summary'in m.get('Game',{}));p.until(lambda m:'Summary'in m.get('Game',{}));assert request('/alive/'+game['game_id'])[1]==b'false'
 # Queries and player frames cannot refresh the idle period.
 _,game,h,p=room();h.send({'Host':{'Next':'Lobby'}});h.until(lambda m:'InfoSlide'in m)
 for _ in range(3):
  h.send({'Host':'RequestTeamRosters'});h.until(lambda m:'TeamRosters'in m.get('Game',{}));p.send({'Player':{'IndexAnswer':0}});time.sleep(.5)
 warning=h.until(lambda m:m.get('Game',{}).get('HostTimeout',{}).get('warning'),5)
 assert not any(isinstance(m,dict) and 'HostTimeout'in m.get('Game',{}) for m in list(p.messages.queue))
 h.send({'Host':'Continue'});ack=h.until(lambda m:m.get('Game',{}).get('HostTimeout',{}).get('generation',0)>warning['Game']['HostTimeout']['generation'])
 assert ack['Game']['HostTimeout']['remaining_ms']==6000 and not ack['Game']['HostTimeout']['warning']
 time.sleep(2.2);assert request('/alive/'+game['game_id'])[1]==b'true'
 h.until(lambda m:'Summary'in m.get('Game',{}),6);p.until(lambda m:'Summary'in m.get('Game',{}));assert request('/alive/'+game['game_id'])[1]==b'false'
 # Replacement close is harmless; final detach starts a fresh period.
 owner,game,h,p=room();replacement,_=host(owner,game);replacement.until(lambda m:'WaitingScreen'in m.get('Game',{}));h.until(lambda m:'closed'in m)
 replacement.send({'Host':'Continue'});replacement.until(lambda m:'HostTimeout'in m.get('Game',{}));replacement.close();time.sleep(1)
 reconnect,_=host(owner,game);reconnect.until(lambda m:'WaitingScreen'in m.get('Game',{}));reconnect.send({'Host':'Continue'});reconnect.until(lambda m:'HostTimeout'in m.get('Game',{}));reconnect.close()
 time.sleep(4);assert request('/alive/'+game['game_id'])[1]==b'true'
 p.until(lambda m:'Summary'in m.get('Game',{}),4);assert request('/alive/'+game['game_id'])[1]==b'false'
 # A transition between warning and expiry cannot replace either deadline.
 owner,_,_,game=create(slides=[{'InfoSlide':{'title':'before transition','duration':5000}},{'InfoSlide':{'title':'after transition','duration':None}}])
 h,_=host(owner,game);h.until(lambda m:'WaitingScreen'in m.get('Game',{}));h.send({'Host':{'Next':'Lobby'}})
 h.until(lambda m:m.get('Game',{}).get('HostTimeout',{}).get('warning'),5)
 h.until(lambda m:m.get('InfoSlide',{}).get('ContentAnnouncement',{}).get('title')=='after transition',2)
 h.until(lambda m:'Summary'in m.get('Game',{}),2)
 print(json.dumps({'passed':'manual End, unauthorized End, host-only warning, Continue reset, read-only/player exclusion, replacement, reconnect, disconnected Summary, independent slide alarm','scenarios':4}))
if __name__=='__main__':main()
