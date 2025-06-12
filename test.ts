console.log("hello!")
Bun.serve({
  fetch(req){
    console.log(req.url);
    return new Response("Hello, world!");
  }
})
