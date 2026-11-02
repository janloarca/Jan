import { attributeYtd } from '@/lib/ytdAttribution'

test('el % por cuenta no se topa en +-200', () => {
  const r = attributeYtd({
    accounts: [{ key: 'a', name: 'A', endVal: 431, start: 100, flow: 0, flowBase: 0, startIsReal: true }],
    portfolioStart: 100, headlineGain: 331,
  })
  const row = r.groups.find((x) => x.key === 'a')
  expect(row && row.ret).toBeCloseTo(331, 5)
})
