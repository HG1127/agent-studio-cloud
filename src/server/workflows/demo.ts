export async function demoWorkflow(name: string) {
  "use workflow";
  const greeting = await greet(name);
  return greeting;
}

async function greet(name: string) {
  "use step";
  return `你好，${name}！工作流引擎已就绪。`;
}
