// Component harness only. Full application entry is tested in customer-database.browser.test.js.
// Reuse the production markup, theme module and unmodified form implementation.
function customerActivityFixture(html){
 return html.replace('id="customerModeSwitch" type="button" hidden','id="customerModeSwitch" type="button"').replace('</head>','<style>#intro{display:none!important}</style></head>').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`
 <script src="/welcome.js"></script>
 <script src="/customer-activity-ui.js"></script>
 <script>
 document.addEventListener('DOMContentLoaded',()=>{
  JamesWelcome.finish();
  const component=JamesCustomerActivity.mount({
   navigate:()=>component.open(),
   initialMode:sessionStorage.getItem('jamesCustomerMode')==='saved'?'saved':'practice'
  });
  document.getElementById('customerActivityOpen').textContent='Open Customer Activity component fixture';
 });
 </script></body>`);
}
module.exports={customerActivityFixture};
