/** maath-style damp without the maath dependency. */
export function damp(object: any, prop: string, goal: number, smoothness: number, delta: number) {
    const t = 1 - Math.exp(-smoothness * delta);
    object[prop] += (goal - object[prop]) * t;
}
