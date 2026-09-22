const output=document.querySelector('#output'),status=document.querySelector('#status'),follow=document.querySelector('#follow');
let text='';
window.logs.onOutput(message=>{
  if(message.type==='reset'){text='';output.textContent='';document.querySelector('#file').textContent=message.text;document.title=`Logs · ${message.text}`;status.className='';status.textContent=follow.checked?'Following · waiting for new lines…':'Last 500 lines';}
  if(message.type==='data'){
    const atBottom=output.scrollHeight-output.scrollTop-output.clientHeight<40;
    text=(text+message.text).slice(-2*1024*1024);output.textContent=text;
    if(atBottom)output.scrollTop=output.scrollHeight;
  }
  if(message.type==='error'){status.textContent=message.text;status.className='error';}
  if(message.type==='end' && !status.className){status.textContent=follow.checked?'Stream ended. Refresh to reconnect.':'Last 500 lines';}
});
async function read(){try{await window.logs.read(follow.checked);}catch(error){status.textContent=error.message;status.className='error';}}
follow.addEventListener('change',read);document.querySelector('#refresh').addEventListener('click',read);read();
