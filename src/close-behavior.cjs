// Main-window close preference shared by the UI and the native close handler.
const behaviors=['ask','exit','minimize'];
function validateCloseBehavior(value){if(!behaviors.includes(value))throw new Error('关闭窗口行为无效');return value}
async function chooseCloseBehavior(current,showDialog){validateCloseBehavior(current);if(current!=='ask')return {action:current};const choice=await showDialog();if(choice.response===2)return {action:'cancel'};const action=choice.response===0?'exit':'minimize';return {action,remember:choice.checkboxChecked?action:undefined}}
module.exports={chooseCloseBehavior,validateCloseBehavior};
