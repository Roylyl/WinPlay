type Timer = ReturnType<typeof setTimeout>
type TimerDependencies = {
 setTimeout:(callback:() => void, delay:number) => Timer
 clearTimeout:(timer:Timer) => void
}
type RecoveryOptions = {
 alternateHost?:string
 onFallback:(host:string) => void
 onWait?:() => void
}

/** One bounded recovery before iPhone opens its CarPlay control connection. */
export class HandoffRecovery {
 private started = false
 private finished = false
 private timers = new Set<Timer>()

 constructor(private options:RecoveryOptions, private clock:TimerDependencies = {setTimeout, clearTimeout}) {}

 negotiationStarted() {
  if (this.started || this.finished) return
  this.started = true
  const alternateHost = this.options.alternateHost?.trim()
  if (alternateHost) this.schedule(12000, () => this.options.onFallback(alternateHost))
  if (this.options.onWait) this.schedule(20000, () => this.options.onWait!())
 }

 private schedule(delay:number, action:() => void) {
  const timer = this.clock.setTimeout(() => {
   this.timers.delete(timer)
   if (!this.finished) action()
  }, delay)
  this.timers.add(timer)
  timer.unref?.()
 }

 networkConnected() { this.cancel() }

 cancel() {
  if (this.finished) return
  this.finished = true
  for (const timer of this.timers) this.clock.clearTimeout(timer)
  this.timers.clear()
 }
}
