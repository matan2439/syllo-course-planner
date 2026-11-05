const original = process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER
  else process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = original
})

test('EE resolves to its own editable-planner identity and picker link when enabled', () => {
  process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = '1'
  jest.isolateModules(() => {
    const { resolveProgram, listProgramFamilies, programQuery } = require('./programs') as typeof import('./programs')
    const ee = resolveProgram('electrical_engineering_2027')!
    expect(ee.id).toBe('electrical_engineering_2027')
    expect(ee.name).toContain('חשמל')
    expect(programQuery(ee.id)).toBe('?program=electrical_engineering_2027')
    expect(listProgramFamilies().find(f => f.id === 'electrical_engineering')?.defaultProgram.id).toBe(ee.id)
  })
})

test('without the integration flag EE stays draft and is not replaced with ME', () => {
  delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER
  jest.isolateModules(() => {
    const { resolveProgram } = require('./programs') as typeof import('./programs')
    expect(resolveProgram('electrical_engineering_2027')).toBeNull()
  })
})
