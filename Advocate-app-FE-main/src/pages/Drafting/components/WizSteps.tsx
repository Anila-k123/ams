import Icon from '../../../ui/Icon'

/** The wizard's numbered step strip (prototype .wz-steps): done steps get a tick,
 *  the current one is marked with aria-current. */
export default function WizSteps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="wz-steps" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className={i < active ? 'done' : undefined} aria-current={i === active ? 'step' : undefined}>
          <span className="n">{i < active ? <Icon name="check" size="sm" /> : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  )
}
