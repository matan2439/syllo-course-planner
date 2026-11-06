const original = process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS
const legacy = process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER
beforeEach(() => { delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER })
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS
  else process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS = original
  if (legacy === undefined) delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER
  else process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = legacy
})

test('a preview allowlist cannot publish a draft in production', () => {
  const originalVercelEnv = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'production'
  process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS = 'electrical_engineering_2027'
  try {
    jest.isolateModules(() => {
      const { resolveProgram } = require('./programs') as typeof import('./programs')
      expect(resolveProgram('electrical_engineering_2027')).toBeNull()
    })
  } finally {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnv
  }
})

test('EE resolves to its own editable-planner identity and picker link when enabled', () => {
  process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS = 'unknown_program, electrical_engineering_2027'
  jest.isolateModules(() => {
    const { resolveProgram, listProgramFamilies, programQuery } = require('./programs') as typeof import('./programs')
    const ee = resolveProgram('electrical_engineering_2027')!
    expect(ee.id).toBe('electrical_engineering_2027')
    expect(ee.name).toContain('חשמל')
    expect(programQuery(ee.id)).toBe('?program=electrical_engineering_2027')
    expect(listProgramFamilies().find(f => f.id === 'electrical_engineering')?.defaultProgram.id).toBe(ee.id)
  })
})

test('the preview allowlist matches full ids rather than prefixes', () => {
  process.env.NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS = 'electrical_engineering'
  jest.isolateModules(() => {
    const { resolveProgram } = require('./programs') as typeof import('./programs')
    expect(resolveProgram('electrical_engineering_2027')).toBeNull()
  })
})
