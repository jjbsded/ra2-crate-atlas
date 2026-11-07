"""Read-only warmups never displace an edited session within the existing bound."""
from threading import Lock
from unittest.mock import patch
import runtime_bootstrap
import simulation_live as L

class Session:
    number=0
    def __init__(self,path,revision=0):
        Session.number+=1;self.token=str(Session.number);self.layout_version=revision
        self.latest_scene=(revision,);self.lock=Lock();self.closed=False
    def close(self):self.closed=True
    def status(self,_):return self.layout_version

with patch.object(L,'prepared_session',lambda path,revision:(Session(path,revision),{})),patch.object(L,'result_path',lambda v:v):
    a=L.open_session({'result':'map'})['session'];L._sessions[a].layout_version=1
    b=L.open_session({'result':'map'})['session'];old=L._sessions[b]
    c=L.open_session({'result':'map'})['session']
    assert a in L._sessions and c in L._sessions and old.closed and len(L._sessions)==2
    assert L.request({'session':a},'status')==1
    L._sessions[c].layout_version=2
    d=L.open_session({'result':'map'})['session']
    assert c not in L._sessions and a in L._sessions and d in L._sessions and len(L._sessions)==2
    try:L.request({'session':c},'status')
    except L.ExpiredSession as e:assert e.code=='LIVE_SESSION_EXPIRED' and e.reason=='capacity-evicted'
    else:raise AssertionError('Expired handles are explicit')
    remaining=L._sessions[a];L.release_session({'session':a});assert remaining.closed
    L.release_session({'session':a})
    try:L.request({'session':a},'status')
    except L.ExpiredSession as e:assert e.reason=='released-by-client'
    else:raise AssertionError('Released handles are explicit')
    # An already admitted paint/edit retains its data until it exits.
    from threading import Event,Thread
    entered,finish=Event(),Event();held=L._sessions[d]
    def blocked(_):entered.set();finish.wait(5);assert not held.closed;return 3
    held.blocked=blocked;thread=Thread(target=lambda:L.request({'session':d},'blocked'));thread.start();assert entered.wait(2)
    L.release_session({'session':d});assert not held.closed;finish.set();thread.join();assert held.closed
    lease='cancelled-opening-1234';L.release_session({'lease':lease})
    try:L.open_session({'result':'map','lease':lease})
    except ValueError:pass
    else:raise AssertionError('A cancelled pending open must never claim a slot')
    entered,finish=Event(),Event();opened=[];failure=[]
    def prepare(path,revision):
        value=Session(path,revision);opened.append(value);entered.set();finish.wait(5);return value,{}
    def opening():
        try:L.open_session({'result':'map','lease':'in-flight-opening-1234'})
        except ValueError as e:failure.append(e)
    with patch.object(L,'prepared_session',prepare):
        thread=Thread(target=opening);thread.start();assert entered.wait(2)
        L.release_session({'lease':'in-flight-opening-1234'});finish.set();thread.join()
    assert failure and opened[0].closed and opened[0].token not in L._sessions
    L.close_all()
print('PASS bounded retention, expiry reasons, release, in-flight safety and pending-open cancellation')
