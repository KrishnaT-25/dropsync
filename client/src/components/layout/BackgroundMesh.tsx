export function BackgroundMesh() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-100"
        style={{
          backgroundImage: `
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 20%, transparent 100%)',
        }}
      />

      <div
        className="animate-float absolute -left-24 top-[-10%] h-[420px] w-[420px] rounded-full blur-[100px]"
        style={{ background: 'var(--mesh-1)' }}
      />
      <div
        className="animate-float-delayed absolute -right-16 top-[20%] h-[360px] w-[360px] rounded-full blur-[90px]"
        style={{ background: 'var(--mesh-2)' }}
      />
      <div
        className="animate-float absolute bottom-[-5%] left-[30%] h-[300px] w-[300px] rounded-full blur-[80px]"
        style={{ background: 'var(--mesh-3)' }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 100% 80% at 50% 0%, transparent 40%, var(--bg) 100%)',
        }}
      />
    </div>
  )
}
