import {articles} from './support-cards.js?v=0.3.6';
import {wrapQuestion} from './support-box.js?v=0.3.6';
export {articles};
const intents = {
 sound:/нет звука|без звука|не слыш(у|но|ен)|ничего не слыш|не звучит|пропал звук|звука нет/,
 tempo:/изменить темп|поменять темп|замедли|ускорить|медленнее|быстрее|настроить темп|ударов в минуту/,
 pause:/как.{0,45}пауз|где.{0,15}пауз|поставить на паузу|приостановить|^пауза$/,
 continue:/продолжить изучение|где.{0,15}остановил|вернуться к занятию|продолжить занятие/,
 eight:/где.{0,22}восемь долей|найти.{0,20}восемь долей|^восемь долей/,
 hands:/следующ.{0,20}(жест|удар)|увидеть.{0,16}(руки|подсказки)/,
 progress:/где.{0,12}прогресс|хранится.{0,12}прогресс|сохран.{0,15}прогресс|^мой прогресс$/,
 metronome:/как.{0,18}метроном|включить метроном|отключить метроном|^метроном$/,
 theory:/где.{0,12}теори|как открыть теори/,
 rotate:/повернуть.{0,15}(экран|телефон)|горизонтальн|блокировк.{0,10}ориентац/
};
export function instant(question) {
 const q=String(question).trim().toLowerCase().replace(/ё/g,'е');
 if(!q || /ошибк|сломал|исчеза|сбой|не помогает|не работает пауза|функци.{0,6}не работает|каким.{0,12}пальц|правильно ли|традици/.test(q)) return null;
 const found=articles.filter(a=>intents[a.id]?.test(q));
 return found.length===1 ? inExercise(found[0],question) : null;
}
// Deployment pins a single product-specific HTTPS endpoint. No model API in the client.
const endpoint = 'https://mridanga-support.sevaapps.org/ask';
function inExercise(article, question) {
 const eight=/(?:восемь|восьм[ьи]|8)\s*(?:дол|групп)|две группы|восьм[её]рк/i.test(question);
 if (!article || !eight) return article;
 const help={
  tempo:'Откройте «Настройки» внутри «Восемь долей». В строке «Темп» выберите меньшее число для медленной игры или большее для быстрой.',
  progress:'Откройте вкладку «Прогресс» внутри упражнения. Здесь сохраняются полные циклы игры на этом устройстве; прослушивание их не добавляет.',
  metronome:'В этом упражнении отдельного переключателя метронома нет. Чтобы изменить скорость, откройте «Настройки» → «Темп».'
 };
 return help[article.id] ? {...article,answer:help[article.id],href:'/eight/',label:'Открыть «Восемь долей»'} : article;
}
export async function askQwen(question, outerSignal) {
 const q=String(question).trim(); if (!q || q.length>450) throw Error('question');
 const ctrl=new AbortController(), abort=()=>ctrl.abort();
 if(outerSignal?.aborted) abort(); else outerSignal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,55000);
 try {
  const box=await wrapQuestion(q);
  const r=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
    headers:{'Content-Type':'application/json'},body:box.body,signal:ctrl.signal});
  if(!r.ok) throw Error('unavailable');
  const v=await box.open(await r.json());
  if(v.source!=='local-qwen'||!Array.isArray(v.ids)||v.ids.length>2||v.ids.some(id=>!articles.some(a=>a.id===id))) throw Error('bad response');
  return v.ids.map(id=>inExercise(articles.find(a=>a.id===id),q));
 } finally {clearTimeout(timer);outerSignal?.removeEventListener('abort',abort);}
}
