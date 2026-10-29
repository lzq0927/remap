"""Export one editable ReMAP slide from source/presentation-data.json.
Usage: python scripts/export-four-part-ppt.py /path/to/review-directory
Dependencies: python-pptx, Pillow; Noto Sans CJK SC installed for measurement.
Charts and text use native PowerPoint shapes. Frozen source data is not edited.
"""
from pathlib import Path
import sys
from collections import defaultdict
import hashlib, json, math, re
from PIL import ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN, MSO_AUTO_SIZE
from pptx.oxml.xmlchemy import OxmlElement

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("/workspace/artifacts/remap-loss-matrix-20261029")
D = json.loads((ROOT / 'source/presentation-data.json').read_text())
T = D['comparison']['topologyDecision']
S = next(s for s in T['scales'] if s['cards'] == 500000)
STAGES = S['scenarios']
NS = [{n['id']: n for n in s['nodes']} for s in STAGES]
IDS = ['domain-1','hardware-network','hardware-storage','hardware-facility','hardware-other','overhead']
DOMAINS = ['01 计算资源','02 网络互联','03 共享存储','04 设施与管理','05 软件与其他','06 公共开销']
LOSS = [('恢复停机',['downtime']),('回滚重算',['rollback']),('亚健康 / 局部降容',['slowdown','localLoss']),('污染失效',['terminalInvalid']),('保存阻塞',['save']),('检测开销',['mechanismOverhead'])]
C = dict(navy='18394F', blue='356D9A', teal='267F74', gold='B98322', ink='20384A', muted='5F7180', line='D5DFE6', pale='F3F6F8', white='FFFFFF', red='A4543B', lightblue='EAF1F8', lightteal='EAF5F1', lightgold='FBF2DC')
LOSS_COLORS = ['CF9B35','587CAA','6D9A91','AA7764','B9A261','8997A7']
FAMILY = 'Noto Sans CJK SC'
FONT_PATH = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FONT = ImageFont.truetype(FONT_PATH, 100)
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(20), Inches(11.25)
prs.core_properties.title = 'ReMAP｜现状分解、损失与可靠性措施'
prs.core_properties.subject = '四部分方法与场景计算结果；独立验证与冻结目标'
prs.core_properties.author = 'ReMAP'
prs.core_properties.keywords = '可靠性,可用度,MTBF,MTTR,FIT,AGREE,Shapley,2026'
CHECKS = []
SLIDE_TEXT = []

def rgb(s): return RGBColor.from_string(C.get(s,s).lstrip('#').upper())
def width(text, size): return FONT.getlength(str(text)) / 100 * size / 72
def wrap(text, size, w):
    result=[]
    for raw in str(text).split('\n'):
        cur=''
        for token in re.findall(r'[A-Za-z0-9._/%+\-]+|.', raw):
            if cur and width(cur+token,size) > w-.025:
                result.append(cur.rstrip());cur=token.lstrip()
            else:cur+=token
        result.append(cur)
    return '\n'.join(result)

def rect(sl,x,y,w,h,fill='white',line=None,radius=False,lw=1):
    sh=sl.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,Inches(x),Inches(y),Inches(w),Inches(h))
    sh.fill.solid();sh.fill.fore_color.rgb=rgb(fill)
    if line: sh.line.color.rgb=rgb(line);sh.line.width=Pt(lw)
    else:sh.line.fill.background()
    if radius:
        try:sh.adjustments[0]=.08
        except (IndexError,AttributeError):pass
    return sh

def txt(sl,x,y,w,h,text,size=16,color='ink',bold=False,align=PP_ALIGN.LEFT,center=False,url=None,auto_wrap=False):
    value=wrap(text,size,w) if auto_wrap else str(text)
    sh=sl.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h))
    sh.name='Text: '+str(text).replace('\n',' / ')[:100]
    tf=sh.text_frame;tf.clear();tf.word_wrap=False;tf.auto_size=MSO_AUTO_SIZE.NONE
    tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0
    tf.vertical_anchor=MSO_ANCHOR.MIDDLE if center else MSO_ANCHOR.TOP
    for i,s in enumerate(value.split('\n')):
        p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        p.alignment=align;p.space_before=p.space_after=Pt(0);p.line_spacing=1.45 if len(value.split("\n"))>1 else 1.1
        r=p.add_run();r.text=s;r.font.name=FAMILY;r.font.size=Pt(size);r.font.bold=bold;r.font.color.rgb=rgb(color)
        rp=r._r.get_or_add_rPr();ea=OxmlElement('a:ea');ea.set('typeface',FAMILY);rp.append(ea)
        if url:
            r.hyperlink.address=url;r.font.underline=False;r.font.color.rgb=rgb(color)
        if width(s,size)>w+.045:CHECKS.append({'slide':len(prs.slides),'kind':'width','text':s,'width':width(s,size),'box':w})
    estimated=size/72*(1.1+1.45*(len(value.split("\n"))-1))
    if estimated>h+.045:CHECKS.append({'slide':len(prs.slides),'kind':'height','text':value,'height':estimated,'box':h})
    if min(x,y)<-.005 or x+w>20.005 or y+h>11.255:CHECKS.append({'slide':len(prs.slides),'kind':'bounds','text':value})
    SLIDE_TEXT[-1].append(value)
    return sh

def line(sl,x1,y1,x2,y2,color='line',lw=1.5,arrow=False,dash=False):
    sh=sl.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,Inches(x1),Inches(y1),Inches(x2),Inches(y2))
    sh.line.color.rgb=rgb(color);sh.line.width=Pt(lw)
    lp=sh.line._get_or_add_ln()
    if arrow:
        a=OxmlElement('a:tailEnd');a.set('type','triangle');lp.append(a)
    if dash:
        a=OxmlElement('a:prstDash');a.set('val','dash');lp.append(a)
    return sh

def path(sl, points, color='blue',lw=2,arrow=True,dash=False):
    for i,(a,b) in enumerate(zip(points,points[1:])):line(sl,*a,*b,color,lw,arrow and i==len(points)-2,dash)

def pill(sl,x,y,w,text,color='blue',fill='lightblue',size=12):
    rect(sl,x,y,w,.31,fill,radius=True);txt(sl,x+.06,y+.025,w-.12,.25,text,size,color,True,PP_ALIGN.CENTER)

def p(v,d=2):return '—' if v is None else f'{v*100:.{d}f}%'
def h(v,d=3):return '—' if v is None else '0' if abs(v)<1e-9 else '<0.001' if 0<v<.001 else f'{v:.{d}f}'
def tm(v):return '—' if v is None else f'{v:.2f} h' if v>=1 else f'{v*60:.2f} min'
def losses(n):return [sum(n['loss'][k] for k in keys) for _,keys in LOSS]
def heat(v):
    t=max(0,min(1,math.log1p(v*60)/math.log1p(600*60)))
    return ''.join(f'{round(a+(b-a)*t):02X}' for a,b in zip([255,253,235],[189,132,21]))
def table(sl,x,y,widths,headers,rows,rh=.56,hh=.6,size=14,colors=None,aligns=None):
    xx=x
    for w,head in zip(widths,headers):
        rect(sl,xx,y,w,hh,'navy');txt(sl,xx+.08,y+.045,w-.16,hh-.09,head,13,'white',True,center=True);xx+=w
    for i,row in enumerate(rows):
        xx=x;yy=y+hh+i*rh
        for j,(w,value) in enumerate(zip(widths,row)):
            bg='pale' if i%2==0 else 'white';fg='ink'
            if colors:
                opts=colors(i,j)
                if opts:bg,fg=opts
            rect(sl,xx,yy,w,rh,bg)
            txt(sl,xx+.08,yy+.045,w-.16,rh-.08,value,size,fg,j==0,align=aligns[j] if aligns else PP_ALIGN.LEFT,center=True)
            xx+=w
        line(sl,x,yy+rh,x+sum(widths),yy+rh,'line',.5)

STUDIES=D['studies']
BR=NS[-1]['system'];CUR=NS[0]['system'];EXT=NS[1]['system']
ATTR=next(a for a in STUDIES[-1]['attribution'] if a['cards']==500000)
RANKS=sorted(ATTR['contributions'],key=lambda c:-c['statistics']['mean'])
LABELS={'fit':'M1 故障源FIT治理','policy:D-HARD':'M3 中断检测','model:recovery':'M4/M8 恢复链与失败升级','policy:C-FAST':'M5 检查点周期与保存','policy:D-SDC':'M6 静默检出','model:silent':'M6 漏检后排查','policy:D-SLOW':'M7 亚健康检测'}
SHORT=['现状','延长线改进','突破性改进']
COLS=['blue','gold','teal']

def newslide(title,subtitle):
    sl=prs.slides.add_slide(prs.slide_layouts[6]);SLIDE_TEXT.append([])
    rect(sl,0,0,20,11.25,'white');rect(sl,0,0,20,.065,'navy')
    txt(sl,.40,.21,18.8,.44,title,27,'navy',True)
    txt(sl,.42,.78,18.9,.26,subtitle,13.4,'muted')
    return sl

def footer(sl,text):txt(sl,.42,10.96,19.0,.20,text,10.2,'muted')
def area(sl,x,y,w,h_,title,col='blue'):
    rect(sl,x,y,w,h_,'white','line',True,.7);rect(sl,x,y,.055,h_,col)
    txt(sl,x+.14,y+.08,w-.28,.27,title,15,col,True)

def topology(sl,x,y,w,h_,detail=False):
    # All positions are transformed from a 1100 × 330 native-shape drawing.
    sx=w/1100;sy=h_/330
    def rr(a,b,c,d,fill='white',stroke='blue'):return rect(sl,x+a*sx,y+b*sy,c*sx,d*sy,fill,stroke,True,.8)
    def tt(a,b,c,d,v,fs=11.4,color='ink',bold=False):return txt(sl,x+a*sx,y+b*sy,c*sx,d*sy,v,fs*(1.22 if detail else 1),color,bold)
    def pp(points,col='teal',dash=False):path(sl,[(x+a*sx,y+b*sy) for a,b in points],col,1.6,False,dash)
    rr(0,0,730,318,'lightblue','blue');tt(10,7,708,22,'950超节点示意 · 16计算柜 × 64 NPU · 2互联柜 / 8平面',12,'blue',True)
    for i in range(16):
        rr(12+i*28,34,23,24,'white');tt(16+i*28,37,18,18,str(i+1),9)
    rr(12,72,445,221);tt(22,79,425,21,'展开计算柜 → 计算框 → 8 NPU计算板',11.5,'blue',True)
    rr(23,107,422,126,'pale','line');rr(31,115,263,78,'lightblue','blue')
    for i in range(8):rr(38+i*31,137,25,45,'white','blue');tt(45+i*31,150,19,20,str(i+1),10,'blue',True)
    tt(38,117,240,17,'计算板：8张NPU；主机位于框内',10.4,'blue')
    rr(303,115,132,78,'white','blue');tt(310,119,119,17,'单NPU / 模组',10,'blue',True)
    for i,label in enumerate(['CORE','SRAM','IOD','HBM']):rr(310+(i%2)*59,141+(i//2)*24,55,20,'lightblue','line');tt(314+(i%2)*59,143+(i//2)*24,49,17,label,8.8)
    for i,label in enumerate(['CPU','DDR','本地SSD']):rr(31+i*137,201,128,22,'white','line');tt(64+i*137,203,91,17,label,10)
    for i,label in enumerate(['L1交换','IO总线','UB网卡']):rr(26+i*139,253,130,27,'lightteal','teal');tt(43+i*139,258,106,21,label,10.8,'teal',True)
    pp([(144,233),(144,243),(90,243),(90,253)]);pp([(310,233),(310,243),(368,243),(368,253)])
    rr(481,200,104,69,'lightgold','gold');tt(491,205,85,18,'光模块',9.9,'gold',True);tt(489,231,92,29,'约250万个',9,'gold')
    pp([(457,265),(470,265),(470,236),(481,236)])
    for i in range(2):
        rr(610,72+i*106,105,93,'lightteal','teal');tt(620,77+i*106,87,18,'互联柜'+str(i+1),10.5,'teal',True)
        for j in range(8):rr(620+(j%4)*21,103+i*106+(j//4)*23,17,18,'white','teal');tt(625+(j%4)*21,105+i*106+(j//4)*23,12,14,str(j+1),8.0)
        pp([(585,235),(596,235),(596,117+i*106),(610,117+i*106)])
    tt(23,296,689,20,'包含关系用嵌套；实线为通信。板、柜与超节点不自动等同独立DP副本。',10.2,'muted')
    pp([(715,220),(739,220),(739,120),(758,120)])
    rr(758,72,327,73,'lightteal','teal');tt(770,80,305,21,'跨超节点网络：Leaf ⇄ Spine',12,'teal',True);tt(770,113,305,20,'光链路 / 域间网络 / 检查点数据传输',10.5)
    for i,(id_,lab) in enumerate([('hardware-storage','03 共享存储'),('hardware-facility','04 供电冷却管理'),('hardware-other','05 软件与其他')]):
        yy=163+i*51;nn=NS[0][id_];rr(758,yy,327,48,'pale','line');tt(770,yy+2,305,18,lab,9.8,'ink',True);tt(770,yy+28,305,18,f"A {p(nn['availability'])} → {p(nn['target'],3)} · 预算 {h(nn['allowedHours'],2)} h",9.3)
    pp([(740,145),(740,286),(758,286)],'muted',True)
    tt(758,12,325,20,'架构上的现状 → 分配目标',12,'blue',True)
    n=NS[0]['domain-1'];tt(758,37,325,20,f"01 计算 {p(n['availability'])} → {p(n['target'],3)}",11.4,'blue',True)

def matrix(sl,x,y,w,cellh=.29,size=12.5,show_params=False):
    labelw=1.64;gap=.20;groupw=(w-labelw-2*gap)/3;totalw=.86;cw=(groupw-totalw)/6
    top=.40;sub=.34
    txt(sl,x,y+.47,labelw-.08,.22,'责任域 / 损失小时',12,'muted',True)
    for k,st in enumerate(STAGES):
        gx=x+labelw+k*(groupw+gap);nn=NS[k]['system']
        rect(sl,gx,y,groupw,top,['lightblue','lightgold','lightteal'][k]);rect(sl,gx,y,groupw,.035,COLS[k])
        txt(sl,gx+.10,y+.07,groupw-.18,.25,f"{SHORT[k]}  {p(nn['availability'])}",14,COLS[k],True)
        for j,lab in enumerate(['停机','回滚','降速','污染','保存','检测']):txt(sl,gx+j*cw,y+top+.055,cw,sub-.05,lab,12,'ink',True,PP_ALIGN.CENTER)
        txt(sl,gx+6*cw,y+top+.035,totalw,sub-.02,'合计/预算',11,'muted',True,PP_ALIGN.CENTER)
    for i,(id_,label) in enumerate(list(zip(IDS,DOMAINS))+[('system','全系统')]):
        yy=y+top+sub+i*cellh
        rect(sl,x,yy,labelw-.06,cellh-.018,'pale');txt(sl,x+.04,yy+.055,labelw-.12,cellh-.07,label.replace('保存检测开销','公共开销'),size-.3,'ink',i==6)
        for k in range(3):
            gx=x+labelw+k*(groupw+gap);nn=NS[k][id_]
            for j,v in enumerate(losses(nn)):
                rect(sl,gx+j*cw,yy,cw-.018,cellh-.018,heat(v));value='0' if v<1e-9 else '<.01' if v<.01 else f'{v:.2f}'
                txt(sl,gx+j*cw,yy+.055,cw-.025,cellh-.07,value,size,'ink',i==6,PP_ALIGN.CENTER)
            text=f"{nn['actualHours']:.2f}/{nn['allowedHours']:.2f}"
            txt(sl,gx+6*cw,yy+.055,totalw,cellh-.07,text,size-2.3,'red' if (nn.get('gapHours') or 0)>1e-9 else 'teal',True,PP_ALIGN.CENTER)
    by=y+top+sub+7*cellh+.03
    txt(sl,x,by,w,.24,'M3/M4/M8 → 停机   ·   M4/M5/M6 → 回滚   ·   M7 → 降速   ·   M6 → 污染   ·   M5 → 保存   |   黄色共用 log(1 + 小时/1分钟) 色尺；棕字为超预算',11.3,'muted')
    return by+.28

def ranking(sl,x,y,w,count=7,rh=.30,size=12):
    mx=max(v['statistics']['mean'] for v in RANKS);labelw=w*.46;valuew=w*.26;barw=w-labelw-valuew-.12
    for i,c in enumerate(RANKS[:count]):
        yy=y+i*rh;v=c['statistics']['mean'];txt(sl,x,yy,labelw-.09,rh-.04,f"{i+1}  {LABELS.get(c['id'],c['name'])}",size,'ink',i<2)
        rect(sl,x+labelw,yy+.065,barw,.15,'pale');rect(sl,x+labelw,yy+.065,barw*v/mx,.15,'teal')
        txt(sl,x+labelw+barw+.09,yy,valuew-.03,rh-.04,f"+{v*100:.2f} pp",size,'teal',True,PP_ALIGN.RIGHT)

def sourcebars(sl,x,y,w,h_):
    maxh=CUR['actualHours'];labelw=.98;valw=.87;bw=w-labelw-valw-.12
    for k,nn in enumerate([CUR,EXT,BR]):
        yy=y+k*h_/3;txt(sl,x,yy,labelw,.25,SHORT[k],11.8,COLS[k],True)
        xx=x+labelw;rect(sl,xx,yy+.025,bw,.20,'pale')
        for j,v in enumerate(losses(nn)):
            ww=bw*v/maxh
            if ww>0:rect(sl,xx,yy+.025,ww,.20,LOSS_COLORS[j]);xx+=ww
        txt(sl,x+labelw+bw+.06,yy,valw,.23,f"{nn['actualHours']:.2f}h",11.8,'ink',True,PP_ALIGN.RIGHT)

sl=newslide('ReMAP｜三阶段损失评估与可靠性措施优化','50万卡主场景 · 600 h固定评估窗口 · 目标98.5% / 总损失预算9 h · 架构、损失、参数与增量收益一一对应')
for i,(title,method,col) in enumerate([('01 目标分解分配','AGREE · 冻结分层损失预算','blue'),('02 可用度评估','结构RBD/BDD辅助；本结果为DES损失账','blue'),('03 机制设计','配对Shapley · 对照三档参数组合','gold'),('04 机制验证','换种子1024轨迹 · 输出能力验收要求','teal')]):
    x=.4+i*4.84;rect(sl,x,1.15,4.69,.57,'pale',radius=True);txt(sl,x+.12,1.20,4.44,.21,title,13.2,col,True);txt(sl,x+.12,1.47,4.44,.18,method,10.6,'muted')
area(sl,.4,1.86,11.55,3.45,'架构与目标分配：物理层级、光链路及共享依赖')
topology(sl,.57,2.30,11.18,2.85)
area(sl,12.1,1.86,7.5,3.45,'独立复核：均值达标，局部责任域仍有差距','teal')
txt(sl,12.29,2.31,3.33,.61,p(BR['availability'],3),34,'teal',True)
st=STAGES[-1]['statistics'];txt(sl,15.73,2.39,3.63,.26,f"95%区间 {p(st['ciLow'],3)}–{p(st['ciHigh'],3)}",13.1,'teal',True)
txt(sl,12.31,3.05,7.03,.25,f"损失 {BR['actualHours']:.3f} h / 9 h   ·   预算余量 {9-BR['actualHours']:.3f} h",16,'ink',True)
txt(sl,12.31,3.43,7.03,.23,f"全系统MTBF {BR['mtbfHours']*60:.2f} min · 等效MTTR {BR['mttrSeconds']:.2f} s",13.4,'muted')
txt(sl,12.31,3.75,7.03,.23,'窗口达标887/1024（86.62%）；45 min为选定中断范围MTBF',11.5,'muted')
sourcebars(sl,12.31,4.11,7.0,.91)
txt(sl,12.31,5.02,7.03,.18,'同轴损失构成：停机 / 回滚 / 降速 / 污染 / 保存 / 检测',10.4,'muted')
txt(sl,.43,5.47,18.9,.27,'三阶段 × 六类损失 × 六个责任域  |  先读每层时长，再对照措施与冻结预算',16,'navy',True)
matrix(sl,.42,5.88,19.16,.279,12.1)
area(sl,.4,8.97,8.2,1.81,'措施增量收益排序 · 现状 → 突破','teal')
ranking(sl,.58,9.38,7.82,4,.265,11.6)
txt(sl,.58,10.51,7.82,.18,'64条配对轨迹 × 32排列；其余：漏检排查、中断检测、亚健康检测。',10.1,'muted')
area(sl,8.77,8.97,10.83,1.81,'优化建议与能力要求：优先兑现M6、M5与恢复链','gold')
txt(sl,8.96,9.39,10.44,.25,'M6：99.91% / 1 s，漏检排查24 h；M5：周期1 s / 保存阻塞0 s（情景假设）',12.1,'ink')
txt(sl,8.96,9.78,10.44,.25,'M3：99.8% / 1 s；M4：99.9% / 15 s；M7：97.5% / 52.6 s。需故障注入验收。',12.1,'ink')
txt(sl,8.96,10.17,10.44,.42,f"计算域超预算 {NS[-1]['domain-1']['gapHours']:.2f} h，软件与其他超 {NS[-1]['hardware-other']['gapHours']:.2f} h；下一轮验证光链路冗余、有限备用池与副本级恢复。",11.5,'red',False,auto_wrap=True)
footer(sl,'2026-10-29 · 修复故障暴露倍率漏用后重算，旧99.069%结论失效。现状基线待校准；区间仅含采样误差；零保存阻塞、FIT与机制参数不代表产品已验证能力。')
sl.notes_slide.notes_text_frame.text=json.dumps({'provenance':D['provenance'],'statistics':st,'incrementalAttribution':ATTR,'warning':'Previous 99.069% simulation omitted generation exposure. Attachment 98.60146% used another event scope and is not an exact replay. Current 15s scenario independently reaches 98.69647%. All rates and rows derived from frozen source.'},ensure_ascii=False,indent=2)
# Disable inherited theme shadows on all native shapes.
def flatten():
    for slide in prs.slides:
        for shape in slide.shapes:
            for effect in shape._element.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}effectRef'):effect.set('idx','0')
            sp=shape._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}spPr')
            if sp is not None and sp.find('{http://schemas.openxmlformats.org/drawingml/2006/main}effectLst') is None:sp.append(OxmlElement('a:effectLst'))
flatten();prs.save(ROOT/'ReMAP-三阶段损失与措施优化-一页.pptx')

sl=newslide('ReMAP｜架构上的现状、分解目标与薄弱责任域','01 AGREE分层分配 → 02 逐事件损失评估 · 50万卡 / 600 h · 各阶段沿用现状预算，结构成功门与训练正确进度分别评价')
topology(sl,.45,1.28,12.0,5.34,True)
area(sl,12.75,1.28,6.8,5.34,'分配方法与判断依据')
txt(sl,12.96,1.82,6.32,1.05,'98.5%目标 → 9 h总损失预算\n逐级按复杂度C、重要度E和设计权重分配。\n同级预算守恒；每个规模独立分配。',16,'ink')
txt(sl,12.96,3.08,6.32,1.01,'E来自损失与正Shapley贡献的工程投影；\n不是条件故障概率，也不是模块独立Shapley。\nFIT、MTBF、等效MTTR共同诊断差距。',14,'muted')
txt(sl,12.96,4.32,6.32,.95,'50万卡突破：整体98.696%，仍有局部缺口。\n计算域 5.320 / 1.565 h；软件与其他 0.814 / 0.732 h。\n目标分配不等于能力已达成。',14,'red',True)
txt(sl,12.96,5.51,6.32,.66,'主图数量为示意；实际配置489超节点、7813计算柜。\n光模块约250万个，源事件分摊及BOM估算可追溯。',12,'muted')
headers=['责任域','现状A → 分配目标','等效FIT¹','现状MTBF','现状等效MTTR','允许损失 h','突破损失 h']
rows=[]
for i,id_ in enumerate(IDS):
 n=NS[0][id_];b=NS[-1][id_];rows.append([DOMAINS[i],f"{p(n['availability'])} → {p(n['target'],3)}",f"{n['fit']:.1f}",tm(n['mtbfHours']),'—' if n['mttrSeconds'] is None else f"{n['mttrSeconds']:.1f} s",f"{n['allowedHours']:.3f}",f"{b['actualHours']:.3f}"])
table(sl,.43,6.91,[2.35,4.3,2.03,2.28,2.9,2.56,2.72],headers,rows,rh=.48,hh=.49,size=14)
footer(sl,'¹ FIT为每卡等效小时口径、含倍率后的责任汇总，单件FIT需另查数量基准。MTBF仅中断事件；等效MTTR由全损失折算。AGREE公式与来源在平台完整留存。')

sl=newslide('ReMAP｜分层损失热力图、措施收益与参数验收','03 机制设计：现状 → 延长线 → 突破性改进 · 04 独立DES验证 · 三块共用黄色色尺，格内数值为损失小时')
matrix(sl,.44,1.27,19.10,.365,13.4)
area(sl,.43,5.08,8.65,5.55,'改进增量Shapley：同一冻结现状的因果分摊','teal')
ranking(sl,.63,5.61,8.2,7,.40,13.3)
txt(sl,.63,8.66,8.2,.78,f"配对组合增量 {ATTR['gain']*100:.3f} pp / {ATTR['gain']*600:.2f} h。\n贡献来自64条共同故障轨迹、32个排列；独立归因样本与\n主表样本不同，组合增量不强行等于主表三档差值。",12.4,'muted')
txt(sl,.63,9.57,8.2,.73,'区间重叠时不强判先后；成本与资源条件尚需补充。\nM2跨域冗余、有限备用、PAFT尚未计入本次收益。\n完整数值、区间及事件归属见平台。',12.4,'muted')
area(sl,9.26,5.08,10.30,5.55,'落到参数与验证：先优化既有能力，再比较新增机制','gold')
param_rows=[['M6 静默检出','99.91% / 1 s；漏检排查24 h','回滚 / 污染'],['M5 检查点','周期1 s；保存阻塞0 s（假设）','回滚 / 保存'],['M3 中断检测','99.8% / 1 s','停机'],['M4/M8 恢复','99.9% / 15 s；失败追加1 h','停机 / 回滚'],['M7 亚健康','97.5% / 52.6 s','降速'],['M1 FIT目标','选定范围MTBF45 min；系统30.49 min','发生频率']]
table(sl,9.45,5.62,[2.13,5.84,1.94],['措施','突破档生效参数 / 工程目标','损失路径'],param_rows,rh=.44,hh=.43,size=12.2)
txt(sl,9.48,8.91,9.70,.54,'验收：故障注入 + 干净进度；同时检查持久化滞后、恢复带宽、失败升级尾部、\n误隔离与共享原因。附件整组参数（22 s / 99.8%恢复等）在当前范围下仅97.974%。',11.9,'muted')
txt(sl,9.48,9.61,9.70,.71,'下一轮：光链路多路径/冗余先做RBD/BDD容量与共因评估；\n有限备用池 + TP/PP/DP映射 + 副本级恢复做同故障样本DES。\n并列给出备用耗尽概率、有效GPU·小时与部署容量成本。',12.8,'blue',True)
footer(sl,'所有改进参数是可验收的情景要求；没有把41.1秒等效MTTR预算写成恢复时间。突破1024轨迹，种子2655407334；均值95%区间98.660%–98.733%。')
flatten();prs.save(ROOT/'ReMAP-拓扑损失与措施-总分三页.pptx')
(ROOT/'source/ppt-layout-checks.json').write_text(json.dumps(CHECKS,ensure_ascii=False,indent=2))
(ROOT/'source/ppt-slide-text.json').write_text(json.dumps(SLIDE_TEXT,ensure_ascii=False,indent=2))
print(json.dumps({'slides':len(prs.slides),'native_shapes':[len(sl.shapes) for sl in prs.slides],'layout_warnings':CHECKS},ensure_ascii=False))
