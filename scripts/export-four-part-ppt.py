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

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("/workspace/artifacts/remap-four-part-20261029")
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

# One page: method column 16%, results 81%, remaining gutters.
prs.core_properties.title = 'ReMAP｜四部分方法与计算结果'
prs.core_properties.subject = '50万卡主视角、四种规模、600小时、独立1024轨迹验证'
sl=prs.slides.add_slide(prs.slide_layouts[6]); SLIDE_TEXT.append([])
rect(sl,0,0,20,11.25,'white'); rect(sl,0,0,20,.075,'navy')
txt(sl,.4,.24,15.8,.43,'ReMAP｜从可用度目标分配到可靠性机制验证',27,'navy',True)
txt(sl,.42,.79,18.9,.27,'一个 Agent · 四个 Skill / 工具集   |   600 h 固定窗口   |   万 / 十万 / 二十万 / 五十万卡统一目标 98.5%（9 h 总损失预算）',14,'muted')
txt(sl,17.15,.30,2.43,.28,'2026-10-29 · 场景复核',12,'blue',True,PP_ALIGN.RIGHT)

def lane(y,h_,number,title,method,explanation,col):
    rect(sl,.4,y,3.04,h_,'pale',radius=True);rect(sl,.4,y,.055,h_,col)
    txt(sl,.57,y+.13,2.72,.32,number+'  '+title,17,col,True)
    txt(sl,.57,y+.60,2.70,.46,method,15,'navy',True,auto_wrap=True)
    txt(sl,.57,y+1.10,2.69,h_-1.19,explanation,12.6,'muted',auto_wrap=True)
    rect(sl,3.62,y,15.98,h_,'white','line',True,.8)

lane(1.2,2.4,'01','目标分解分配','AGREE · 分层损失预算','重要度、复杂度与现状证据\n分配后冻结预算，跨档比较。\n图中为50万卡分配结果；\n预算分配仍需正向验证。','blue')
lane(3.72,1.72,'02','可用度评估','RBD / BDD ＋ 损失账','结构成功门与训练指标分开；\n本表训练可用度来自DES。','blue')
lane(5.56,2.88,'03','可靠性机制设计','Shapley · 组合与参数设计','先看损失路径，再选措施。\n三档减损与单项因果贡献\n使用各自明确的基线。\n黄色越深，损失越大；\n红框表示突破档仍超预算。','gold')
lane(8.56,1.75,'04','可靠性机制验证','独立离散事件仿真','冻结参数 · 换种子 · 1024轨迹\n输出达标统计及精确参数。','teal')

# 01: Physical enclosure, explicit communication, responsibility allocations.
txt(sl,3.82,1.31,15.5,.24,'架构上的现状 → 分配目标（A = 1 − 本域损失 / 600 h）；括号内为允许损失，六域合计 9 h',12.5,'muted')
rect(sl,3.84,1.72,8.43,1.57,'pale','blue',True)
txt(sl,4.0,1.79,8.04,.26,'代表性 Atlas 950 超节点：16 计算柜 × 64 NPU · 2 互联柜 · 8 平面',13,'blue',True)
rect(sl,3.99,2.16,4.10,.97,'white','blue',True)
txt(sl,4.10,2.22,3.88,.24,'01 计算资源  55.32% → 99.731%（1.613 h）',12.4,'blue',True)
rect(sl,4.13,2.59,3.77,.40,'lightblue','line',True)
txt(sl,4.21,2.63,3.59,.27,'柜 → 框/板 → NPU〔CORE / SRAM / IOD〕',11.5,'ink')
txt(sl,4.08,3.32,7.98,.19,'包含关系用嵌套框；计算另含 HBM、CPU、DDR、本地SSD。光模块单独列出。',10.5,'muted')
rect(sl,8.48,2.16,3.60,.97,'white','blue',True)
txt(sl,8.60,2.22,3.36,.22,'02 网络  96.90% → 99.414%（3.514 h）',12,'blue',True)
txt(sl,8.63,2.63,1.14,.23,'L1 / IO / UB',11.8,'ink')
line(sl,9.78,2.76,9.98,2.76,'blue',1.3,True)
rect(sl,10.02,2.59,.84,.31,'lightgold','gold',True)
txt(sl,10.05,2.625,.78,.22,'光模块',12,'gold',True,PP_ALIGN.CENTER)
line(sl,10.92,2.76,11.20,2.76,'blue',1.3,True)
txt(sl,11.30,2.63,.57,.23,'L2',12,'ink',True)
path(sl,[(8.10,2.68),(8.47,2.68)],'blue',2.1)
line(sl,12.09,2.68,12.48,2.68,'muted',1.3,True,True)
for i,(idx,title) in enumerate([(2,'03 共享存储'),(3,'04 设施与管理'),(4,'05 软件与其他'),(5,'06 公共开销')]):
    x=12.56+(i%2)*3.44;y=1.72+(i//2)*.88;n=NS[0][IDS[idx]]
    rect(sl,x,y,3.29,.77,'pale','line',True)
    txt(sl,x+.11,y+.07,3.07,.21,title+f"  ({n['allowedHours']:.3f} h)",12,'ink',True)
    txt(sl,x+.11,y+.38,3.07,.25,f"{n['availability']*100:.2f}% → {n['target']*100:.3f}%",15,'teal',True)

# 02: Four-scale decisions plus actual loss-source bars.
widths=[.82,1.37,1.37,1.48,1.40]
rows=[]
for sc in T['scales']:
    av=[next(n for n in s['nodes'] if n['id']=='system')['availability'] for s in sc['scenarios']]
    rows.append([f"{sc['cards']//10000}万",*[p(a) for a in av],f"{(av[0]-.985)*100:+.2f} pp"])
table(sl,3.83,3.80,widths,['规模','现状','延长线','突破复核','现状距目标'],rows,rh=.26,hh=.30,size=12.7,
      colors=lambda i,j: ('lightteal','teal') if j==3 else ('white','red') if j==4 else None)
txt(sl,3.85,5.21,6.34,.18,'全系统现状：MTBF 15.12 min · 等效MTTR 1,195.8 s',10.5,'muted')
txt(sl,10.54,3.82,8.78,.25,'50万卡现状损失来源｜回滚重算＋恢复停机占 91.9%',14,'navy',True)
current_losses=losses(NS[0]['system']); order=sorted(range(6),key=lambda i:-current_losses[i])
for j,i in enumerate(order):
    yy=4.16+j*.208;val=current_losses[i]
    txt(sl,10.56,yy,1.60,.18,['恢复停机','回滚重算','亚健康/降容','污染失效','保存阻塞','检测开销'][i],10.2,'muted')
    rect(sl,12.22,yy+.025,5.62,.105,'pale')
    if val>0:rect(sl,12.22,yy+.025,5.62*val/max(current_losses),.105,LOSS_COLORS[i])
    txt(sl,18.02,yy-.005,1.28,.19,f'{val:.2f} h',10.4,'ink',True,PP_ALIGN.RIGHT)

# 03: Shared yellow log scale, actual hours, direct mechanism categories and mappings.
txt(sl,3.84,5.72,6.18,.25,'责任域 × 三档损失（小时）',15,'navy',True)
x=3.84;y=6.09;ws=[1.60,1.50,1.50,1.50]
headers=['责任域','现状','延长线','突破复核'];xx=x
for w,v in zip(ws,headers):
    rect(sl,xx,y,w,.31,'navy');txt(sl,xx+.07,y+.045,w-.14,.22,v,12.4,'white',True);xx+=w
for i,name in enumerate(['01 计算','02 网络','03 存储','04 设施','05 软件/其他','06 公共开销']):
    yy=y+.31+i*.263;txt(sl,x+.07,yy+.026,1.46,.22,name,12.4,'ink',True)
    for j in range(3):
        n=NS[j][IDS[i]];xx=x+1.60+j*1.50
        rect(sl,xx,yy,1.50,.263,heat(n['actualHours']),'red' if j==2 and n['gapHours']>1e-8 else 'white',lw=1.2 if j==2 and n['gapHours']>1e-8 else .3)
        txt(sl,xx+.07,yy+.026,1.36,.22,f"{n['actualHours']:.3f}",12.9,'ink',True,PP_ALIGN.CENTER)
txt(sl,3.9,8.06,6.10,.19,'共用色尺：log(1 + 损失小时 / 1分钟)，范围 0–600 h',10.7,'muted')
txt(sl,10.30,5.72,8.98,.25,'具体措施 → 损失路径 → 验证条件',15.5,'navy',True)
for yy,lab,body,col in [
 (6.13,'MTBF','M1 筛查/纠错；M2 跨域冗余 → 减少中断与传播','blue'),
 (6.50,'MTTR','M3 检测＋M4 恢复/M8 兜底 → 停机；M5 检查点 → 回滚/保存','teal'),
 (6.87,'正确性','M6 静默校验 → 污染；M7 慢机/弱链路隔离 → 降速','gold')]:
    pill(sl,10.31,yy,.97,lab,col,'pale',11.5)
    txt(sl,11.45,yy+.025,7.87,.27,body,12.7,'ink')
txt(sl,10.32,7.31,8.96,.28,'Shapley：现状静默检测 +20.98 pp（95%区间 16.92–25.04 pp）',13.1,'blue',True)
txt(sl,10.32,7.66,8.96,.21,'相对现状冻结基线、32条/子集；非三档组合差值的因果归因。',11.3,'muted')
txt(sl,10.32,7.98,8.96,.24,'新增建议：有限备用池＋副本级恢复＋异步多层检查点；资源条件补齐后复评。',12,'teal',True)

# 04: Independent results first, then the exact parameters that produced them.
stat=STAGES[2]['statistics'];root=NS[2]['system'];calc=NS[2]['domain-1'];soft=NS[2]['hardware-other']
txt(sl,3.85,8.71,3.20,.23,'50万卡突破情景 · 独立复核',13,'teal',True)
txt(sl,3.84,9.03,3.30,.52,p(stat['mean'],3),31,'teal',True)
txt(sl,3.87,9.65,3.45,.22,f"95%区间 {p(stat['ciLow'],3)}–{p(stat['ciHigh'],3)}",11.6,'ink')
txt(sl,3.87,9.98,3.45,.22,f"窗口达标 {stat['successes']}/1024（{p(stat['achievementProbability'])}）",12,'muted')
line(sl,7.50,8.79,7.50,10.10,'line')
txt(sl,7.74,8.76,2.87,.27,f"总损失 {root['actualHours']:.3f} / 9 h",15,'navy',True)
txt(sl,7.74,9.18,2.87,.25,f"总体余量 {9-root['actualHours']:.3f} h",14,'teal',True)
txt(sl,7.74,9.58,2.87,.24,f"计算超预算 {calc['gapHours']:.3f} h",13.3,'red',True)
txt(sl,7.74,9.94,2.87,.22,f"软件/其他超 {soft['gapHours']:.3f} h",12.3,'red')
line(sl,10.78,8.79,10.78,10.10,'line')
txt(sl,11.00,8.74,8.35,.26,'生效参数（模型情景，工程能力仍需验证）',14,'navy',True)
txt(sl,11.00,9.13,8.35,.24,'中断检测 99.8% / 1 s；静默 99.91%；慢机 97.5% / 52.6 s',13.1,'ink')
txt(sl,11.00,9.47,8.35,.24,'恢复成功 99.9% / 合计15 s；失败后追加1 h；检查点1 s / 阻塞0 s',12.7,'ink')
txt(sl,11.00,9.82,8.35,.29,'MTBF 45 min（所选中断范围）；全系统 30.49 min / 等效MTTR 17.2 s',12.5,'teal',True)

# Keep limitations adjacent to results; full raw records and methods are in the task bundle.
line(sl,.4,10.48,19.6,10.48,'line',.8)
txt(sl,.43,10.60,19.1,.23,'口径：前两档沿用128轨迹冻结重建快照；突破档1024条、种子2655407334。现状43.14%与专家60%参考仍需校准；非此前98.719%快照重放。',11.7,'muted')
txt(sl,.43,10.91,19.1,.23,'边界：采样区间不含模型/参数不确定性；41.1 s是条件预算，未写入恢复耗时；零阻塞、备用耗尽、TP/PP/DP恢复边界与持久化滞后需工程验证。',11.7,'muted')
sl.notes_slide.notes_text_frame.text='\n'.join([
 '一页结果汇总；原生可编辑形状。完整平台保留架构包含/连接关系、FIT/MTBF/MTTR、逐层六类损失、三档热力图、Shapley和2026厂商资料。',
 'AGREE为固定训练窗口损失预算的工程适配，不将各域A相乘。现状证据分配预算在三档比较中冻结。结构RBD/BDD与训练DES分开；本页训练数值来自DES。',
 '新增有限备用池、PAFT/副本恢复及多层异步检查点尚需动态资源条件，未计入本次额外收益。',
 '2026-10-29修正检查点周期浮点除法与取模不一致导致的偶发重复计时，新增时间守恒回归测试；历史结果未重写。',
 json.dumps(D['provenance'],ensure_ascii=False,indent=2),
 json.dumps(D['verification'].get('workflowContext',{}),ensure_ascii=False,indent=2),
])
assert len(prs.slides)==1
assert abs(sum(NS[0][i]['allowedHours'] for i in IDS)-9)<1e-9
assert all(s['statistics']['n']==1024 for s in [q['scenarios'][2] for q in T['scales']])
path_out=ROOT/'ReMAP-四部分方法与计算结果-一页.pptx'
for shape in sl.shapes:
    props=shape._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}spPr')
    if props is not None: props.append(OxmlElement('a:effectLst'))
    for effect in shape._element.xpath('./p:style/a:effectRef'): effect.set('idx','0')
prs.save(path_out)
(ROOT/'source/layout-checks.json').write_text(json.dumps(CHECKS,ensure_ascii=False,indent=2))
(ROOT/'source/slide-text.json').write_text(json.dumps(SLIDE_TEXT,ensure_ascii=False,indent=2))
print(json.dumps({'path':str(path_out),'slides':1,'shapes':len(sl.shapes),'layoutIssues':CHECKS},ensure_ascii=False))
