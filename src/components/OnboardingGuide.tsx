import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent } from 'react'

type OnboardingTarget = 'menu' | 'settings' | 'history' | 'memory' | 'rollback' | 'debug' | 'instructions' | 'portrait' | 'content'

interface GuideStep {
  target?: OnboardingTarget
  text: string
  hint?: string
  highlights?: Array<{ text: string; tone?: 'blue' | 'pink' }>
  expression?: 'smile' | 'shy'
}

const STEPS: GuideStep[] = [
  { text: '欢迎来到RPGBox，这是一个类似迷你酒馆的LLM对话框架。我是像素深渊的艾莉西亚，您的专属秘书，由我向您快速讲解RPGBox的大致功能~', hint: '（点击立绘、对话框文本或下一步继续）' },
  { target: 'menu', text: '这里是RPG列表和系统菜单，可以在这里配置AI模型、新建或导入RPG。', highlights: [{ text: 'RPG列表' }, { text: '系统菜单' }] },
  { target: 'settings', text: '每个RPG可以进行自由设置，包括选择AI模型，设置RPG规则，设置剧情偏好，以及登场人物。', highlights: [{ text: 'AI模型' }, { text: 'RPG规则' }, { text: '剧情偏好' }, { text: '登场人物' }] },
  { target: 'settings', text: 'RPG规则主要用于设计文风、叙事模式、状态栏规则等规则类内容。', highlights: [{ text: 'RPG规则' }] },
  { target: 'settings', text: '剧情偏好主要用于录入故事背景、偏好的❤❤❤场景、不同叙事模式下的特殊故事框架等等。', highlights: [{ text: '剧情偏好' }, { text: '❤❤❤', tone: 'pink' }] },
  { target: 'settings', text: '登场人物主要用于设置主角和NPC的人设，以及在不同叙事模式下的立绘。', highlights: [{ text: '登场人物' }] },
  { target: 'history', text: 'RPG的所有历史聊天记录都在这里，您也可以在这里清空所有记录重新开始。', highlights: [{ text: '历史聊天记录' }] },
  { target: 'memory', text: 'RPG故事按章节划分，每个章节结束后会自动整理记忆和角色经历；超过5个章节时，多的章节会自动归档成远期记忆。', highlights: [{ text: '记忆' }, { text: '角色经历' }] },
  { target: 'memory', text: '如果自动总结失败，您也可以手动调用AI再次总结，或直接输入。' },
  { target: 'rollback', text: '如果对这一轮对话不满意，或AI返回异常、破限失败，可以从这里撤回到上一轮对话末尾，最多撤回最近的5次。' },
  { target: 'debug', text: '这里可以查看发送给AI的原文、AI返回的原文，方便查找问题。' },
  { target: 'instructions', text: '这里是特殊指令，可以对AI进行一定控制，比如尝试修复格式、调整单次篇幅等等。', highlights: [{ text: '特殊指令' }] },
  { target: 'portrait', text: '这里是立绘区，参与对话的角色会在这里出现，顶部有当前的时间、地点以及叙事模式。', highlights: [{ text: '立绘区' }, { text: '时间' }, { text: '地点' }, { text: '叙事模式' }] },
  { target: 'content', text: '这里是文字区，用于显示旁白、对话以及选项，选项可以多选，也可以自由输入补充。', highlights: [{ text: '文字区' }, { text: '选项' }] },
  { text: '这就是RPGBox的主要功能了，这是一个开放框架，适合组织章节式短篇故事集，您可以自由设计自己的故事背景。', highlights: [{ text: '开放框架' }, { text: '章节式短篇故事集' }] },
  { text: '还有……如果您对我参与的故事感兴趣，我会在 预设_像素深渊 中等您……', highlights: [{ text: '预设_像素深渊', tone: 'pink' }], expression: 'shy' },
]

const PORTRAITS = {
  smile: './onboarding/艾莉西亚_战斗服_微笑.png',
  shy: './onboarding/艾莉西亚_战斗服_羞耻.png',
}

function renderStepText(step: GuideStep) {
  const tones = new Map(step.highlights?.map(({ text, tone = 'blue' }) => [text, tone]))
  if (!tones.size) return step.text
  const pattern = [...tones.keys()]
    .sort((left, right) => right.length - left.length)
    .map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return step.text.split(new RegExp(`(${pattern})`, 'g')).map((part, partIndex) => {
    const tone = tones.get(part)
    return tone ? <span className={`onboarding-emphasis onboarding-emphasis-${tone}`} key={`${part}-${partIndex}`}>{part}</span> : part
  })
}

export default function OnboardingGuide({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0)
  const [focus, setFocus] = useState<DOMRect | null>(null)
  const step = STEPS[index]
  const measure = useCallback(() => {
    if (!step.target) return setFocus(null)
    const selector = `[data-onboarding-target="${step.target}"]`
    const element = step.target === 'portrait' || step.target === 'content'
      ? document.querySelector<HTMLElement>(`.onboarding-guide ${selector}`)
      : document.querySelector<HTMLElement>(selector)
    setFocus(element?.getBoundingClientRect() ?? null)
  }, [step.target])

  useLayoutEffect(measure, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [measure])

  function next() {
    if (index === STEPS.length - 1) onFinish()
    else setIndex((value) => value + 1)
  }

  function advanceOnKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    next()
  }

  const focusStyle = focus ? (() => {
    const left = Math.max(4, focus.left - 5)
    const top = Math.max(4, focus.top - 5)
    const right = Math.min(window.innerWidth - 4, focus.right + 5)
    const bottom = Math.min(window.innerHeight - 4, focus.bottom + 5)
    return { left, top, width: right - left, height: bottom - top }
  })() : null

  return <div className="onboarding-guide" role="dialog" aria-label="RPGBox新手导航">
    <div className="onboarding-topbar-guard" aria-hidden="true" />
    {focusStyle && <div className="onboarding-focus" style={focusStyle} />}
    <div className="onboarding-scene" aria-live="polite">
      <div className="onboarding-portrait-zone" data-onboarding-target="portrait" role="button" tabIndex={0} onClick={next} onKeyDown={advanceOnKey} aria-label="继续新手导航"><img src={PORTRAITS[step.expression ?? 'smile']} alt="艾莉西亚" /></div>
      <div className="onboarding-content-zone">
      <div className="onboarding-dialogue" data-onboarding-target="content" role="button" tabIndex={0} onClick={next} onKeyDown={advanceOnKey} aria-label="继续新手导航">
        <div className="onboarding-speaker"><strong>艾莉西亚</strong><span>{index + 1} / {STEPS.length}</span></div>
        <p>{renderStepText(step)}{step.hint && <><br /><span className="onboarding-hint">{step.hint}</span></>}</p>
      </div>
      </div>
    </div>
    <footer className="onboarding-dock">
      <button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} title="上一步"><ChevronLeft size={20} /><span>上一步</span></button>
      <button className="onboarding-skip" onClick={onFinish} title="跳过新手导航"><SkipForward size={17} /><span>跳过</span></button>
      <button className="onboarding-next" onClick={next}>{index === STEPS.length - 1 ? '完成' : '下一步'}<ChevronRight size={20} /></button>
    </footer>
  </div>
}
