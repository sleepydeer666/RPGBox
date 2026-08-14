import { describe, expect, it } from 'vitest'
import { parseAssistantResponse } from './parser'
import { mergeStructureRepair } from './repair'

describe('mergeStructureRepair', () => {
  it('appends only repaired options to the original story', () => {
    const merged = mergeStructureRepair('[旁白] 夜色降临。\n维纳斯（平静）：跟我来。', 'A. 跟上她\nB. 留在原地\nC. 询问原因\nD. 检查四周')
    const parsed = parseAssistantResponse(merged ?? '')

    expect(parsed.choices).toHaveLength(4)
    expect(parsed.segments).toHaveLength(2)
    expect(merged).toContain('[选项A] 跟上她')
  })

  it('rejects a repair response with fewer than four choices', () => {
    expect(mergeStructureRepair('正文', 'A. 继续\nB. 等待\nC. 离开')).toBeNull()
  })

  it('keeps all configured new-story choices', () => {
    const response = [
      'A. 与维纳斯调查港口',
      'B. 邀请露娜前往王都',
      'C. 和两人探索遗迹',
      'D. 拜访旅店老板',
      'E. 追踪神秘信使',
      'F. 参加城中庆典',
      'G. 暂时留在村庄',
    ].join('\n')
    const merged = mergeStructureRepair('新的引子。', response, 7)

    expect(parseAssistantResponse(merged ?? '').choices).toHaveLength(7)
    expect(merged).toContain('[选项G] 暂时留在村庄')
  })

  it('accepts four ordinary choices with a larger new-story setting', () => {
    const response = 'A. 继续\nB. 等待\nC. 询问\nD. 离开'
    expect(parseAssistantResponse(mergeStructureRepair('正文', response, 7) ?? '').choices).toHaveLength(4)
  })

  it('rejects an ambiguous choice count', () => {
    expect(mergeStructureRepair('正文', 'A. 一\nB. 二\nC. 三\nD. 四\nE. 五', 7)).toBeNull()
  })
})
