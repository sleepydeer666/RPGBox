import { describe, expect, it } from 'vitest'
import { parseAssistantResponse } from './parser'
import { mergeStructureRepair } from './repair'

describe('mergeStructureRepair', () => {
  it('appends only repaired options to the original story', () => {
    const merged = mergeStructureRepair('夜色降临。\n维纳斯（平静）：跟我来。', 'A. 跟上她\nB. 留在原地\nC. 询问原因\nD. 检查四周')
    const parsed = parseAssistantResponse(merged ?? '')

    expect(parsed.choices).toHaveLength(4)
    expect(parsed.segments).toHaveLength(2)
    expect(merged).toContain('[选项A] 跟上她')
  })

  it('rejects a repair response with fewer than four choices', () => {
    expect(mergeStructureRepair('正文', 'A. 继续\nB. 等待\nC. 离开')).toBeNull()
  })
})
