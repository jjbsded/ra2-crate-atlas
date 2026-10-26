/* Reviewed pronunciations for the bundled official catalog only. Keep syllable
 * boundaries here; full spelling and initials are derived once, without a
 * runtime Chinese dictionary. New catalog names must pass the coverage test. */
(function(root){
 'use strict';
 const rows=`万福马利亚|wan fu ma li ya
三叉路口|san cha lu kou
不列兹然湖|bu lie zi ran hu
世仇|shi chou
乡村乐|xiang cun yue
侵略消息获得证实|qin lve xiao xi huo de zheng shi
俄国轮盘|e guo lun pan
冰天雪地|bing tian xue di
冷战|leng zhan
加州|jia zhou
加州高速公路|jia zhou gao su gong lu
北极圈|bei ji quan
南太平洋|nan tai ping yang
卡维利护航舰队|ka wei li hu hang jian dui
危险场所|wei xian chang suo
双峰|shuang feng
发射中的火箭|fa she zhong de huo jian
君王大陆|jun wang da lu
咫尺天涯|zhi chi tian ya
四角战争|si jiao zhan zheng
围攻之都|wei gong zhi du
地狱山丘|di yu shan qiu
地表零|di biao ling
坚守领土|jian shou ling tu
埃及之旅|ai ji zhi lv
城市商业区|cheng shi shang ye qu
城市突击战|cheng shi tu ji zhan
大矿区|da kuang qu
天寒地冻|tian han di dong
太平洋顶点|tai ping yang ding dian
失落之湖|shi luo zhi hu
奥林巴斯山|ao lin ba si shan
孤立之海|gu li zhi hai
宝石山谷|bao shi shan gu
尖峰时刻|jian feng shi ke
尤里的阴谋|you li de yin mou
山丘对决|shan qiu dui jue
山多纳海峡|shan duo na hai xia
岛屿之战|dao yu zhi zhan
岛屿战争|dao yu zhan zheng
峡谷战争|xia gu zhan zheng
当东方遇上最佳|dang dong fang yu shang zui jia
德州，奥斯汀|de zhou ao si ting
心脏地带|xin zang di dai
快乐踪迹|kuai le zong ji
恐怖岛|kong bu dao
恶劣无剩|e lie wu sheng
战争园地|zhan zheng yuan di
拖车屋停驻场|tuo che wu ting zhu chang
拯救行动|zheng jiu xing dong
攻击与防御|gong ji yu fang yu
新顶点|xin ding dian
暴风天|bao feng tian
曼哈顿暴行|man ha dun bao xing
杀手本能|sha shou ben neng
桥缝|qiao feng
榴霰弹堆|liu xian dan dui
欧帝斯之岛|ou di si zhi dao
正式锦标赛地图|zheng shi jin biao sai di tu
正式锦标赛地图 A|zheng shi jin biao sai di tu a
正式锦标赛地图 B|zheng shi jin biao sai di tu b
正面冲突|zheng mian chong tu
死亡谷之女|si wang gu zhi nv
水獭复仇记|shui ta fu chou ji
永远的竞技场|yong yuan de jing ji chang
污水坑|wu shui keng
沙丘一角|sha qiu yi jiao
沙丘巡礼|sha qiu xun li
波多马克之师|bo duo ma ke zhi shi
海啸|hai xiao
海市蜃楼|hai shi shen lou
海滩|hai tan
深水炸弹|shen shui zha dan
湖泊之战|hu po zhi zhan
满载的油桶|man zai de you tong
火线冲突|huo xian chong tu
灾难边缘|zai nan bian yuan
爆裂物|bao lie wu
特区暴动|te qu bao dong
狂野战区|kuang ye zhan qu
猪纙湾|zhu luo wan
生死斗|sheng si dou
甲板室後座|jia ban shi hou zuo
电塔|dian ta
白令海峡|bai ling hai xia
百慕达三角洲|bai mu da san jiao zhou
秘密山谷|mi mi shan gu
竞技场|jing ji chang
紧要关头|jin yao guan tou
纪念谷|ji nian gu
绝对颠峰|jue dui dian feng
缆桩脊|lan zhuang ji
美国小镇|mei guo xiao zhen
脱逃|tuo tao
草地战争|cao di zhan zheng
蒙大拿非军事区|meng da na fei jun shi qu
西伯利亚荒原|xi bo li ya huang yuan
谭雅的训练场|tan ya de xun lian chang
超级大麻烦|chao ji da ma fan
适者生存|shi zhe sheng cun
酷热乾旱|ku re gan han
重入深山|chong ru shen shan
重返巴黎|chong fan ba li
长征|chang zheng
防卫区争夺|fang wei qu zheng duo
阿拉斯加油矿|a la si jia you kuang
雪地生机|xue di sheng ji
雪谷|xue gu
马里布悬崖|ma li bu xuan ya
黄尘地带|huang chen di dai
黄金之街|huang jin zhi jie
黄金国|huang jin guo`.split('\n').map(row=>row.split('|'));
 for(let campaign=1;campaign<=5;campaign++)for(let map=1;map<=5;map++)rows.push([`战役 ${campaign} 地图 ${map}`,`zhan yi ${campaign} di tu ${map}`]);
 const pronunciations=new Map(rows),aliases=new Map(rows.map(([name,value])=>{const syllables=value.split(' '),full=syllables.join('');return [name,[...new Set([full,syllables.map(s=>s[0]).join(''),full.replace(/([nl])v/g,'$1u')])]];}));
 const api={pronunciations,aliases};root.CrateOfficialMapNames=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
