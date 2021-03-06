const DEBUG_ENABLED = false
const DEBUG_INFO_ENABLED = false
const DEBUG_WARNING_ENABLED = true
const _debug = { log: (...args)=> DEBUG_ENABLED && console.log(...args) }
const _info = { log: (...args)=> DEBUG_INFO_ENABLED && console.log(...args) }
const _warning = { log: (...args)=> DEBUG_WARNING_ENABLED && console.log(...args) }

// syntatic sentinel..maybe use symbol in future..
/* export */ const pass = undefined
/* export */ const none = ()=>undefined


// utils
const copyObjPropsInplace = (copy_from, copy_into, props) => {
  Object.keys(copy_from).forEach(p=>{
    if (props.includes(p)){
      copy_into[p] = copy_from[p]
    }
  })
}

// export 
const toInlineStyle = /** @param {CSSStyleDeclaration | ()=>CSSStyleDeclaration} styles - use "::" on single style name to specify no name translation! */(styles)=>{ 
  if((typeof styles) === "function"){styles=styles()}; 

  let style = ""

  Object.keys(styles).forEach(s=>{
      if (s.startsWith("::")){
          style += s+":"+styles[s]+";"
      }
      else {
          style += s.split(/(?=[A-Z])/).join('-').toLowerCase()+":"+styles[s]+";"
      }
  })

  return style
}

const isFunction = (what)=>typeof what === "function"

const recursiveAccessor = (pointer, toAccess)=>{
  // _debug.log("recursiveAccessor", pointer, toAccess)
  if (toAccess.length === 1)
    return [pointer, toAccess[0]]
  else {
    // _debug.log("ritornerĂ²: ", pointer, toAccess[0], pointer[toAccess[0]])
    return recursiveAccessor(pointer[toAccess[0]], toAccess.slice(1))
  }
}

const cloneDefinitionWithoutMeta = (definition)=>{
  let componentType = getComponentType(definition)
    
  let {meta, ...oj_definition_no_meta} = definition[componentType]
  return {[componentType]: oj_definition_no_meta}
}

// Framework

class PropAlias {
  constructor(getter=()=>{}, setter=()=>{}, markAsChanged=()=>{}, cachingComparer=()=>false, onChangesRegisterFunc){
    this.getter = getter
    this.setter = setter
    this.markAsChanged = markAsChanged
    this.cachingComparer = cachingComparer
  }
}
// export
const Alias = (getter=()=>{}, setter=()=>{}, markAsChanged=()=>{}, cachingComparer=()=>false, onChangesRegisterFunc)=>new PropAlias(getter, setter, markAsChanged, cachingComparer, onChangesRegisterFunc)
// export
const SmartAlias = (getterAndSetterStr, cachingComparer=()=>false)=>{
  return new PropAlias(
    smartFunc(getterAndSetterStr, true),
    smartFuncWithCustomArgs("v")("("+getterAndSetterStr+" = v)", true), 
    pass,
    cachingComparer
  )
}

class Property{
  constructor(valueFunc, onGet, onSet, onDestroy, executionContext, registerToDepsHelper, init=true){
    // execution context per fare la bind poco prima di chiamare (o per non bindare e chiamare direttamente..)
    // "registerToDepsHelper..un qualcosa che mi fornisce il parent per registrarmi alle mie dpes..in modo da poter settare anche altro e fare in modo da non dover conoscere il mio padre, per evitare ref circolari" restituisce i "remover"
    this.executionContext = (Array.isArray(executionContext) ? executionContext : [executionContext]).map(ec=>isFunction(ec) ? ec : ()=>ec) // interface for "dynamic execution context"..wrap in lambda aslo if not passed..
    this.registerToDepsHelper = registerToDepsHelper
    this.onChangedHandlers = []
    this.dependency = undefined
    this.registeredDependency = [] // container of depsRemoverFunc

    // todo: caching, if enabled
    // this.cacheIsValid = false
    // this.cachedValue = undefined

    if (init){
      this.init(valueFunc, onGet, onSet, onDestroy) // helper, to separate prop definition from initializzation (for register)
    }
  }

  init(valueFunc, onGet, onSet, onDestroy){
    // todo: caching, if enabled
    // this.cacheIsValid = false
    // this.cachedValue = undefined
    this.oj_valueFunc = valueFunc
    
    this.isAlias = valueFunc instanceof PropAlias
    if (this.isAlias) { valueFunc = valueFunc.getter }

    this.isFunc = isFunction(valueFunc)

    this._onGet = onGet
    this._onSet = onSet
    this._onDestroy = onDestroy

    this._latestResolvedValue = undefined
    this._valueFunc = valueFunc
    this.__analyzeAndConnectDeps()

    try{ this._latestResolvedValue = this.__getRealVaule() } catch {} // with this trick (and setting on markAsChanged and set value) we can compare new and old!
  }

  __analyzeAndConnectDeps(){
    // step 1: remove old deps (if any)
    this.registeredDependency.forEach(depsRemoverFunc=>depsRemoverFunc())
    this.registeredDependency = []
    this.dependency = undefined
    // step 2: compute the new deps and register to it
    if (this.isFunc){
      this.dependency = analizeDepsStatically(this._valueFunc)
      _info.log("analysis - dependency: ", this, this.dependency)
      this.registeredDependency = this.registerToDepsHelper(this, this.dependency) // it's my parent competence to actually coonect deps!
    }
  }

  destroy(alsoDependsOnMe=false){
    this.init(undefined, undefined, undefined) // this will remove alse deps connection (but not who depends on me!)
    this.registerToDepsHelper = undefined
    if (alsoDependsOnMe){
      return this.removeAllOnChengedHandler() // this will return the old deps (eg. to restore deps after a destroy/recreate cycle)
    }
    this._onDestroy && this._onDestroy()
  }

  __getRealVaule(){
    return this.isFunc ? this._valueFunc(...this.executionContext.map(ec=>ec())) : this._valueFunc
    // todo: caching, if enabled
    // if (this.cacheIsValid) {return this.cachedValue}
    // this.cachedValue = this.isFunc ? this._valueFunc(...this.executionContext.map(ec=>ec())) : this._valueFunc
    // this.cacheIsValid = true
    // return this.cachedValue
  }

  get value(){
    this._onGet() // this._onGet?.()
    // debug.log(this, "retrived!")
    return this.__getRealVaule()
  }
  set value(v){
    // todo: caching, if enabled
    // this.cacheIsValid=false
    if(this._onSet === undefined){_warning.log("CLE - WARNING: the onSet is undefined!", this);return} // todo: teeemp!! c'Ă¨ un bug piĂ¹ subdolo da risolvere..riguarda gli le-for e le-if nested..
    if(this.isAlias){
      this.oj_valueFunc.setter(...this.executionContext.map(ec=>ec()), v)
    }
    else {
      this.isFunc = isFunction(v)
      this._valueFunc = v
      this.__analyzeAndConnectDeps()
      let _v = this.__getRealVaule()
      this._onSet(_v, v, this)
      this.fireOnChangedSignal()
      this._latestResolvedValue = _v // in this way during the onSet we have the latest val in "_latestResolvedValue" fr caching strategy
    }
  }

  // manually, useful for deps
  markAsChanged(){
    // todo: caching, if enabled
    // this.cacheIsValid=false
    // todo: potenzialmente qui posso controllare i change in cascata..controllo che non Ă¨ cambiato nulla (con comparer) e non triggero la fire etc..
    _debug.log("marked as changed!", this)
    if(this._onSet === undefined){_warning.log("CLE - WARNING: the onSet is undefined!", this);return} // todo: teeemp!! c'Ă¨ un bug piĂ¹ subdolo da risolvere..riguarda gli le-for e le-if nested..
    if (this.isAlias){
      this.oj_valueFunc.markAsChanged(...this.executionContext.map(ec=>ec()))
    } // always execute this to retrive myDeps changes
    let _v = this.__getRealVaule()
    this._onSet(_v, this._valueFunc, this)
    if (this.isAlias && this.oj_valueFunc.cachingComparer !== undefined ){
      if (this.oj_valueFunc.cachingComparer(_v, this._latestResolvedValue)){
        this.fireOnChangedSignal()
        this._latestResolvedValue = _v
      }
      else { _debug.log("cached!")}
    }else{
      this.fireOnChangedSignal()
      this._latestResolvedValue = _v
    }
  }


  // registered changes handler, deps and notify system
  fireOnChangedSignal(){
    this.onChangedHandlers.forEach(h=>h.handler(this.__getRealVaule(), this._latestResolvedValue))
  }
  hasOnChangedHandler(who){
    return this.onChangedHandlers.find(h=>h.who === who) !== undefined
  }
  addOnChangedHandler(who, handler){ // return the remove function!
    if(!this.hasOnChangedHandler(who)){
      this.onChangedHandlers.push({who: who, handler: handler})
    }
    return ()=>this.removeOnChangedHandler(who)
  }
  removeOnChangedHandler(who){
    this.onChangedHandlers = this.onChangedHandlers.filter(h=>h.who !== who)
  }
  removeAllOnChengedHandler(){
    let oldChangedHandlers = this.onChangedHandlers
    this.onChangedHandlers = []
    return oldChangedHandlers
  }

}

class Signal {
  constructor(name, definition){
    this.name = name;
    this.definition = definition;
    this.handlers = []
  }

  emit(...args){
    this.handlers.forEach(h=>h.handler(...args))
  }

  hasHandler(who){
    return this.handlers.find(h=>h.who === who) !== undefined
  }
  addHandler(who, handler){
    if(!this.hasHandler(who)){
      this.handlers.push({who: who, handler: handler})
    }
    return ()=>this.removeHandler(who)
  }
  removeHandler(who){
    this.handlers = this.handlers.filter(h=>h.who !== who)
  }

  destroy(){ // todo: integrare todo per bene!
    let to_notify_of_destroy = this.handlers.map(h=>h.who)
    this.handlers = []
    return to_notify_of_destroy
  }

  // proxy dei signal esposto agli user, che possono fare solo $.this.signalName.emit(...)
  static getSignalProxy = (realSignal)=> ( {emit: (...args)=>realSignal.emit(...args)} )

}

class SignalSubSystem {
  singals = {} // Map?? e uso un component dell'albero direttamente..cosĂ¬ perĂ² rischio di perdere il "riferimento" in caso di dynamics..o meglio, va gestito bene..

  toRegister = {}

  addSignal(signal){

  }
  removeSignal(signal){

  }

  replaceSignal(oldSignal, newSignal){ // quando so che c'Ă¨ una replace/update di un nodo..devo replecare per far in modo che le subscribe funzionino ancora

  }

  registerToSignal(signal, who){

  }

  sendSignal(signal, ...args) {
    //mentre segnalo bisogona controllare che esiste ancora il sengale..potrebbe portare all'eleiminazione'..

  }

  _dispatchSignal(){}

}

class DBus {
  // signals = {
  //   s1: new Signal("s1", "stream => void")
  // }
  // handlersToRegister = { // waiting for signal creation..then will be attached!
  //   s1: [{who: 0, handler: 0}]
  // }

  constructor(){
    this.signals = {}
    this.handlersToRegister = {}
    this.proxy = {}
  }

  hasSignal(name){
    return this.signals[name] !== undefined
  }

  addSignal(name, definition){
    if (!this.hasSignal(name)){
      this.signals[name] = new Signal(name, definition)
      this.proxy[name] = Signal.getSignalProxy(this.signals[name])
      if (this.handlersToRegister[name]){
        Object.values(this.handlersToRegister[name]).forEach(({who, handler})=>{
          this.addSignalHandler(name, who, handler)
        })
        this.handlersToRegister[name] = undefined
      }
    }
    return this.signals[name]
  }
  addSignalHandler(name, who, handler){

    if(!this.hasSignal(name)){
      if (this.handlersToRegister[name] === undefined){ this.handlersToRegister[name] = [] }
      this.handlersToRegister[name].push({who: who, handler: handler})
    } 
    else {
      this.signals[name].addHandler(who, handler)
    }
    return ()=>this.signals[name].removeHandler(who)
  }

  getProxy(){
    return this.proxy
  }

}


// smart component: convert {div: "hello"} as {div: {text: "hello"}}
// export 
const smart = (component, otherDefs={}) => {
  return Object.entries(component).map( ([tag, text])=>( {[tag]: {text: text, ...otherDefs }} ) )[0]
}

//const Use = (component, redefinition, initialization_args=$=>({p1:1, p2:"bla"}), passed_props= $=>({prop1: $.this.prop1...}) )=>{ 
// export 
const Use = (component, redefinitions=undefined, { strategy="merge", init=undefined, passed_props=undefined, inject=undefined}={})=>{ return new UseComponentDeclaration(component, redefinitions, { strategy:strategy, init:init, passed_props:passed_props, inject: inject } ) } // passed_props per puntare a una var autostored as passed_props e seguirne i changes, mentre init args per passare principalmente valori (magari anche props) ma che devi elaborare nel construct
// todo: qui potrebbe starci una connect del signal con autopropagate, ovvero poter indicare che propago un certo segnale nel mio parent! subito dopo la redefinitions, in modo da avere una roba molto simile a quello che ha angular (Output) e chiudere il cerchio della mancanza di id..
// di fatto creiamo un nuovo segnale e lo connettiamo in modo semplice..nel parent chiamo "definePropagatedSignal"
// perdo solo un po di descrittivitĂ , in favore di un meccanismo comodo e facile..

// nella init il punto di vista del this E' SEMPRE IL MIO PARENT

class UseComponentDeclaration{
  constructor(component, redefinitions=undefined, { strategy="merge", init=undefined, passed_props=undefined, inject=undefined }={}){
    this.component = component // Todo: e se voglio ridefinire un componente giĂ  Use??
    this.init = init
    this.passed_props = passed_props
    this.redefinitions = redefinitions
    // assert strategy in "merge" | "override"
    this.strategy = strategy

    this.inject = inject

    this.computedTemplate = this._resolveComponentRedefinition()
  }

  _resolveComponentRedefinition(){
    let componentType = getComponentType(this.component)
    let resolved = Object.assign({}, this.component[componentType]) // shallow copy of first level..

    if (this.redefinitions !== undefined){
      if (this.strategy === "override"){
        resolved = {...resolved, ...this.redefinitions}
      } 
      // TO DO: deep copy
      else if (this.strategy === "merge") {

        // throw new Error("Not Implemented Yet!")
        const impossible_to_redefine = ["ctx_id"]
        const direct_lvl = ["id", "constructor", "beforeInit", "onInit", "afterChildsInit", "afterInit", "onUpdate", "onDestroy"] // direct copy
        const first_lvl = ["signals", "dbus_signals", "data", "private:data", "props", "private:props", "let", "alias", "handle"] // on first lvl direct
        const second_lvl = ["on", "on_s", "on_a"]
        const first_or_second_lvl = ["def", "private:def"] // check for function (may exist "first lvl namespace")
 
        Object.entries(this.redefinitions).forEach(([k,v])=>{
          if (direct_lvl.includes(k)){
            // todo: use null to delete 
            // if (v === null)
            //   delete resolved[k]
            // else
            //   resolved[k] = v
            resolved[k] = v
          }
          else if (first_lvl.includes(k)){ //copio il primo lvl
            if (!(k in resolved)){ 
              resolved[k] = {}
            }
            else {
              resolved[k] = {...resolved[k]}
            }
            Object.entries(v).forEach(([kk,vv])=>{
              // _info.log(k, kk, vv)
              resolved[k][kk] = vv
            })
          }
          else if (second_lvl.includes(k)){ //copio il secondo lvl
            if (!(k in resolved)){
              resolved[k] = {}
            }
            else {
              resolved[k] = {...resolved[k]}
            }
            Object.entries(v).forEach(([kk,vv])=>{
              if ((resolved[k] !== undefined) && !(kk in resolved[k])){
                resolved[k][kk] = {}
              }
              else {
                resolved[k][kk] = {...resolved[k][kk]}
              }
              Object.entries(vv).forEach(([kkk,vvv])=>{
                // if ((resolved[k][kk] !== undefined) && (typeof resolved[k][kk] === "object") && !(kkk in resolved[k][kk])){
                //   resolved[k][kk][kkk] = {}
                // }
                resolved[k][kk][kkk] = vvv
              })
            
            })
          }
          else if (first_or_second_lvl.includes(k)){ //copio il primo o il secondo lvl
            if (!(k in resolved)){
              resolved[k] = {}
            }
            else {
              resolved[k] = {...resolved[k]}
            }
            Object.entries(v).forEach(([kk,vv])=>{
              if (typeof vv === "function"){ // Ă¨ un first lvl!
                resolved[k][kk] = vv
              }
              else { // Ă¨ un second lvl!
                if ((resolved[k] !== undefined) && !(kk in resolved[k])){
                  resolved[k][kk] = {}
                }
                else {
                  resolved[k][kk] = {...resolved[k][kk]}
                }
                Object.entries(vv).forEach(([kkk,vvv])=>{
                  // if ((resolved[k][kk] !== undefined) && (typeof resolved[k][kk] === "object") && !(kkk in resolved[k][kk])){
                  //   resolved[k][kk][kkk] = {}
                  // }
                  resolved[k][kk][kkk] = vvv
                })
              
              }
            })
          
          }
          else if (impossible_to_redefine.includes(k)){
            _warning.log("CLE - WARNING!", k, "cannot be redefined!")
          }
          else {
            _warning.log("CLE - WARNING! ACTUALLY", k, "is not supported in merge strategy! i simply FULL override it! assuming you can control the amount of override..")
            resolved[k] = v
          }


        })
        
        _info.log("RESOLVED!", this.component[componentType], this.redefinitions, resolved)

      }
    }
    
    // now check for injections!
    let injections = this.inject || {}
    let childs_def_typology = ["childs", "contains", "text", ">>", "=>", "_", '']
    const recursive_check_injection = (resolved_component, lvl=0) =>{

      // _debug.log("Level: ", lvl, resolved_component)

      if (typeof resolved_component === "function" || typeof resolved_component === "string" || (resolved_component instanceof UseComponentDeclaration) ){
        return resolved_component
      }

      // salvo il rif al componente
      let oj_resolved_component = resolved_component

      if (lvl > 0){ // per i lvl successivi allo 0 devo estrarre la def dal componente
        resolved_component = resolved_component[getComponentType(resolved_component)]
      }
  
      // _debug.log("Not blocked, level: ", lvl, resolved_component)

      childs_def_typology.forEach( childs_def_key => {
        let childs_def = resolved_component[childs_def_key] 
        
        if (childs_def !== undefined ){
          if (Array.isArray(childs_def)){ // multi child
            resolved_component[childs_def_key] = childs_def.map(child=> child instanceof PlaceholderDeclaration ? child.getCheckedComponent(injections[child.name]) : recursive_check_injection(child, lvl++)).filter(c=>c!==undefined)
          }
          else{
            let child = childs_def // monochild, not null
            resolved_component[childs_def_key] = child instanceof PlaceholderDeclaration ? child.getCheckedComponent(injections[child.name]) : recursive_check_injection(child, lvl++)
          }
        }
      })

      return oj_resolved_component
    
    }

    recursive_check_injection(resolved)
    
    return { [componentType]: resolved }
  }

  cloneWithoutMeta(){
    let redefinitions_no_meta = undefined

    if (this.redefinitions !== undefined){
      let {meta, ..._redefinitions_no_meta} = this.redefinitions
      redefinitions_no_meta = _redefinitions_no_meta
    }

    return new UseComponentDeclaration(
      cloneDefinitionWithoutMeta(this.component), redefinitions_no_meta, { strategy:this.strategy, init:this.init, passed_props:this.passed_props, inject:this.inject }
    )
  }

}

// export // utils per fare estensioni rapide senza dichiarare un nuovo meta..
const Extended = (...args) => Use(...args).computedTemplate

// export // todo: valutare se qui ci vuole la copia!
const Placeholder = (name, {default_component=undefined, must_be_redefined=false, forced_id=undefined, forced_ctx_id=undefined, replace_if_different=true}={}) => {
  return new PlaceholderDeclaration(name, {default_component:default_component, must_be_redefined:must_be_redefined, forced_id:forced_id, forced_ctx_id:forced_ctx_id, replace_if_different:replace_if_different})
}
class PlaceholderDeclaration{
  constructor(name, {default_component=undefined, must_be_redefined=false, forced_id=undefined, forced_ctx_id=undefined, replace_if_different=true}={}){
    this.name = name
    this.default_component = default_component
    this.must_be_redefined = must_be_redefined
    this.forced_id = forced_id
    this.forced_ctx_id = forced_ctx_id
    this.replace_if_different = replace_if_different
  }
  getCheckedComponent(component){
    if (component === undefined){
      if (this.must_be_redefined){
        throw new Error("Injected Component (Placeholder repl) must be redefined by contract!")
      }
      return this.default_component
    }

    if (typeof component === "function" || typeof component === "string" ){
      return component
    }

    let [componentType, component_def] = Object.entries(component)[0]
    if (this.replace_if_different === false){
      
      if( (this.forced_id !== undefined && component_def.id !== this.forced_private_id) ||
          (this.forced_ctx_id !== undefined && component_def.ctx_id !== this.forced_ctx_id) ){
        throw new Error("Injected Component (Placeholder repl) must have specific ID by contract")
      } else {
        return component
      }
    }
    else {
      return {
        [componentType]: { 
          ...component_def, 
          id: this.forced_id || component_def.id,
          ctx_id: this.forced_ctx_id || component_def.ctx_id,
        }
      }
    }
  }
}

const extractChildsDef = (definition)=>{
  let extracted_childs = undefined
  let { childs, contains: childs_contains, text: childs_text, ">>":childs_ff, "=>": childs_arrow, _: childs_underscore, '': childs_empty } = definition
  extracted_childs = childs || childs_contains || childs_text || childs_ff || childs_arrow || childs_underscore || childs_empty
  if (extracted_childs !== undefined && !Array.isArray(unifiedDef.childs)) {extracted_childs = [extracted_childs]}
  return extracted_childs
}

const getComponentType = (template)=>{
  // let componentDef;

  if (template instanceof UseComponentDeclaration){
    // componentDef = template
    template = template.computedTemplate
  }
  
  let entries = Object.entries(template)
  _info.log(template, entries)
  if(entries.length > 1){
    throw new Error()
  }
  let [elementType, definition] = entries[0]

  return elementType
  // return [elementType, componentDef ?? definition] // per i template veri restituisco la definizione (aka la definizione del componente), mentre per gli UseComponent il template/classe passata
}

const analizeDepsStatically = (f)=>{

  // const f = $ => $.this.title + $.parent.width + $.le.navbar.height

  let to_inspect = f.toString()

  // replace va perchĂ¨ fa la replace solo della prima roba..alternativa un bel cut al numero di caratteri che sappiamo giĂ 
  let $this_deps = to_inspect.match(/\$.this\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $this_deps = $this_deps?.map(d=>d.replace("$.this.", "").split(".")[0]) // fix sub access!
  
  let $parent_deps = to_inspect.match(/\$.parent\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $parent_deps = $parent_deps?.map(d=>d.replace("$.parent.", "").split(".")[0]) // fix sub access!

  let $scope_deps = to_inspect.match(/\$.scope\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $scope_deps = $scope_deps?.map(d=>d.replace("$.scope.", "").split(".")[0]) // fix sub access!

  let $le_deps = to_inspect.match(/\$.le\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $le_deps = $le_deps?.map(d=>d.replace("$.le.", "").split(".").slice(0,2)) 

  let $ctx_deps = to_inspect.match(/\$.ctx\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $ctx_deps = $ctx_deps?.map(d=>d.replace("$.ctx.", "").split(".").slice(0,2)) 

  let $meta_deps = to_inspect.match(/\$.meta\.([_$a-zA-Z]+[0-9]*[.]?)+/g)
  $meta_deps = $meta_deps?.map(d=>d.replace("$.meta.", "").split(".")[0]) // fix sub access!

  return {
    // todo: vedere se hanno senso
    $this_deps: $this_deps, 
    // $pure_this_deps: $this_deps.length === 1 && $this_deps[0]==="", 

    $parent_deps: $parent_deps, 
    // $pure_parent_deps: $parent_deps.length === 1 && $parent_deps[0]==="", 

    $scope_deps: $scope_deps, 
    // $pure_scope_deps: $scope_deps.length === 1 && $scope_deps[0]==="", 

    $le_deps: $le_deps, 
    // $pure_le_depss: $le_deps.length === 1 && $le_deps[0]==="", 

    $ctx_deps: $ctx_deps, 
    // $pure_ctx_deps: $ctx_deps.length === 1 && $ctx_deps[0]==="", 

    $meta_deps: $meta_deps, 
    // $pure_meta_deps: $meta_deps.length === 1 && $meta_deps[0]==="", 
  }

}

// class ComponentProxySentinel {
//   constructor(obj){
//     Object.assign(this, obj)
//   }
// }

// Property proxy, frontend for the dev of the component Property, usefull to hide the .value mechanism (get/set) of Property
// let deps_stack = [];
const ComponentProxy = (context, lvl=0)=>{

  return new Proxy(context, {

      get: (target, prop, receiver)=>{
        let prop_or_value_target = target[prop];
        if (prop_or_value_target instanceof Property){
          // _debug.log("GET", prop, "--", lvl, "--->", target, "isProperty!");
          return prop_or_value_target.value
          // todo: questo sarebbe un ottimo punto per intervenire dinamicamente su array e object, per far si che una modifica di 1,2 o x livello diretta possa effettivamente scatenare la change..esempio proxando i metodi tipo push etc per fare una markAsChanged
        }
        // _debug.log("GET", prop, "--", lvl, "--->", target);
        return prop_or_value_target
      },

      set: function(target, prop, value) {
        // _debug.log("SET", target, prop, value)

        let prop_or_value_target = target[prop];
        if (prop_or_value_target instanceof Property){
          // not-todo, intercept and setup dependency again --> done inside Property
          prop_or_value_target.value = value
          return true
        } // you can only set existing prpoerty value..to avoid stupid imperative tricks!

      }
  })
}

// $scope proxy..dynamically resolve 
const ComponentScopeProxy = (context)=>{

  const findComponentPropHolder = (component, prop, search_depth=0, noMetaInScope=false)=>{
    if(search_depth === 0){
      noMetaInScope = component.meta_options.noMetaInScope
    }
    if (component === undefined || component.$this === undefined){
      return {}
    }

    if (search_depth === 0 && component.meta_options.noThisInScope){ // salta il this e vai a parent..
      return findComponentPropHolder(component.parent, prop, search_depth+1, noMetaInScope)
    }

    if (prop in (component.$this?.this || {})){ // fix IterableViewComponent, cannot habe $this..
      return component.properties
    }
    if (!noMetaInScope && prop in (component.meta || {})){ // fix IterableViewComponent, cannot habe $this..
      return component.meta
    }
    else if(component.meta_options.isNewScope){
      throw Error("Properties cannot be found in this scope..blocked scope?")
    }
    else {
      return findComponentPropHolder(component.parent, prop, search_depth+1, noMetaInScope)
    }
  }

  return new Proxy({}, {

      get: (_target, prop, receiver)=>{
        let target = findComponentPropHolder(context, prop)
        let prop_or_value_target = target[prop];
        if (prop_or_value_target instanceof Property){
          return prop_or_value_target.value
        }
        return prop_or_value_target
      },

      set: function(_target, prop, value) {

        let target = findComponentPropHolder(context, prop)
        // console.log("setting:", target, prop, value)
        // console.log("type:", target[prop], target[prop] instanceof Property)

        let prop_or_value_target = target[prop];
        if (prop_or_value_target instanceof Property){
          prop_or_value_target.value = value
          return true
        } // you can only set existing prpoerty value..to avoid stupid imperative tricks!

      }
  })
}


class ComponentsContainerProxy {
  // public proxy

  constructor(){

    // qui ci vuole una cosa molto semplice: metto una prop "_data" private vero container dei component, e un proxy che fa la get anche del "super" in ricorsione..su cui baso il proxy!

    this.proxy = new Proxy(this, { // todo..proxy Ă¨ visibile all'interno?????? bug???
      get: function (target, prop, receiver){
        // _debug.log(target, prop, target[prop], target[prop].$this.this)
        return target[prop].$this.this
      }
    })

  }
}

// TODO: manually specify the remap event, throttling, lazy..
class Binding {
  constructor(bindFunc, remap, event){
    this.bindFunc = bindFunc
    this.remap = remap
    this.event = event
  }
}
// export 
const Bind = (bindFunc, {remap=undefined, event=undefined}={}) => new Binding(bindFunc, remap, event)



class ComponentRUUIDGen{
  static __counter = 0;
  static __modifier_on_max = ""
  static generate(){ if(this.__counter >= Number.MAX_SAFE_INTEGER){this.__counter = 0; this.__modifier_on_max+="-"}; return "t-le-id-" + (this.__counter++) + this.__modifier_on_max }
  static reset(){ this.__counter = 0 }
};
// const CRUUID =  () => ComponentRUUIDGen.generate()


// export 
const RenderApp = (html_root, definition)=>{

  let component_tree_root = new ComponentsTreeRoot(html_root, definition)
  component_tree_root.initAndRenderize()

  return component_tree_root

}


class ComponentsTreeRoot {

  html_root
  oj_definition
  components_root

  $le // ComponentsContainerProxy
  $dbus
  $cssEngine

  // step 1: build
  constructor(html_root, definition){
    this.html_root = html_root
    this.oj_definition = definition

    this.$le = new ComponentsContainerProxy()
    this.$dbus = new DBus()
  }

  // step 2 & 3: build skeleton (html pointer & child) and renderize
  initAndRenderize(){

    this.buildSkeleton()

    this.components_root.create()

  }

  buildSkeleton(){

    this.components_root = Component.componentFactory(this.html_root, this.oj_definition, this.$le, this.$dbus)
    this.components_root.buildSkeleton()

  }

  destroy(){
    this.components_root.destroy()
  }

}

// @interface Component base defintion
class IComponent {
  constructor(parent, definition, $le){}
  
  buildSkeleton(){}
  create(){}
  destroy(){}

}

class Component {

  id  // public id
  _id // private (or $ctx) id
  
  oj_definition
  convertedDefinition
  
  isMyParentHtmlRoot // boolean
  parent // Component
  childs // Component []

  properties = {}// real Props Container, exposed (in a certain way) to the dev. Contains: [Property, ()=> ... manual property changes signal launcher, SignalProxy (aka signals api for dev, .emit..), def namespace (std object), def]
  // attrProperties = {}// real attr Props Container // todo: qualcosa del genere per gli attr
  signals = {} // type {signalX: Signal}
  hooks = {}// hook alle onInit dei componenti etc..
  meta = {} // container of "local" meta variable (le-for)
  
  signalsHandlerRemover = []

  // todo: def dependency mechanism
  // typeOfPropertiesRegistry = { // todo: registry to identify the type of an exposed properties, for now only def will be here
  //   // key: "def", "defContainer" | "property", "manualPropertyMarker"| "signal"
  // }
  defDeps = {} // to keep track of def dependencies


  // Frontend for Dev
  $this  // ComponentProxy -> binded on user defined function, visible to the dev as $.this
  $parent // ComponentProxy ==> in realtĂ  Ă¨ this.parent.$this, visible to the dev as $.parent
  $scope // ComponentProxy ==> in realtĂ  Ă¨ l'insieme di $this e di tutti i this.parent.$this in ricorsione, visible to the dev as $.scope
  $le // ComponentsContainerProxy - passed, visible to the dev as $.le
  $ctx // ComponentsContainerProxy - created if is a ctx_component, visible to the dev as $.ctx
  isA$ctxComponent = false
  // $bind // ComponentProoxy -> contains the property as "binding"..a sort of "sentinel" that devs can use to signal "2WayBinding" on a property declaration/definition, visible to the dev as $.bind, usefull also to define intra-property "alias"
  $dbus 
  $meta // ComponentProxy => contains all "meta", local and from parents, in the same Component


  htmlElementType
  isObjComponent
  html_pointer_element
  html_end_pointer_element // future use, per i componenti dinamici e liste..
  css_html_pointer_element

  // step 1: build
  constructor(parent, definition, $le, $dbus){
    this.isA$ctxComponent = ((definition instanceof UseComponentDeclaration) || !(parent instanceof Component))
    this.parent = parent
    this.isMyParentHtmlRoot = (parent instanceof HTMLElement) // && !((parent instanceof Component) || (parent instanceof UseComponentDeclaration)) // if false it is a parent HTML node

    this.$le = $le
    this.$dbus = $dbus
    this.$ctx = this.getMy$ctx()
    this.$meta = this.getMy$meta()

    this.oj_definition = definition

    this.htmlElementType = getComponentType(definition)
    this.isObjComponent = ["Model", "Controller", "Component", "Connector", "Signals", "Style", "Css"].includes(this.htmlElementType)
    this.convertedDefinition = Component.parseComponentDefinition( (definition instanceof UseComponentDeclaration ? definition.computedTemplate : definition) [this.htmlElementType])
    this.meta_options = {
      isNewScope: this.convertedDefinition.meta?.newScope,
      noThisInScope: this.convertedDefinition.meta?.noThisInScope,
      noMetaInScope: this.convertedDefinition.meta?.noMetaInScope,
      hasViewChilds: this.convertedDefinition.meta?.hasViewChilds
    } 

    this.defineAndRegisterId()

  }

  getMy$ctx(){ // as singleton/generator
    if(this.isA$ctxComponent){
      return this.$ctx ?? new ComponentsContainerProxy()
      // i context devono vedere indietro..ovvero vedo anche i contesti dietro di me! devono essere inclusivi (a run time)
    }

    else{
      if (this.parent !== undefined && (this.parent instanceof Component)){
        return this.parent.getMy$ctx()
      }
      
      return undefined
    }
  }

  // todo: questa cosa potrebbe essere super buggata..perchĂ¨ io in effetti faccio una copia delle var e non seguo piĂ¹ nulla..
  getMyFullMeta(){
    if(this.isA$ctxComponent){ //&& !this.allowSuperMeta
      return this.meta
    }

    else{
      if (this.parent !== undefined && (this.parent instanceof Component)){
        return {...this.parent.getMyFullMeta(), ...this.meta}
      }
      
      return {}
    }

  }
  getMy$meta(){ // as singleton/generator
    if(this.isA$ctxComponent){
      _info.log("Component meta:", this.meta, this.oj_definition, this)
      return ComponentProxy(this.meta)
    }

    else{
      if (this.parent !== undefined && (this.parent instanceof Component)){
        _info.log("Parernt meta:", this.parent.meta, this.oj_definition, this)
        return ComponentProxy(this.getMyFullMeta())
      }
      
      return undefined
    }
  }


  get$ScopedPropsOwner(prop, search_depth=0, noMetaInScope=false){
    if(search_depth === 0){
      noMetaInScope = this.meta_options.noMetaInScope
    }

    if (this.parent === undefined || !(this.parent instanceof Component)){ // || this.parent instanceof IterableViewComponent)){
      return [this, /*isPropertiesProp = */ true]
    }

    if (search_depth === 0 && this.meta_options.noThisInScope){ // salta il this e vai a parent..
      return this.parent.get$ScopedPropsOwner(prop, search_depth+1, noMetaInScope)
    }

    if (prop in this.properties){
      return [this, true]
    }
    else if (!noMetaInScope && prop in this.meta){
      return [this, false]
    }
    else if (this.meta_options.isNewScope){
      throw Error("Properties cannot be found in this scope..blocked scope?")
    }
    else {
      return this.parent.get$ScopedPropsOwner(prop, search_depth+1, noMetaInScope)
    }

  }

  defineAndRegisterId(){

    this.id = this.convertedDefinition.id
    this._id = this.convertedDefinition._id

    if (this.id !== undefined){
      this.$le[this.id] = this
      this.$ctx[this.id] = this
    }
    if (this._id !== undefined){
      this.$ctx[this._id] = this
    }

    // USE _root_ e _ctxroot_ per accedere alla root di tutto e alla root del context
    if(this.isMyParentHtmlRoot){
      this.$le["_root_"] = this
    }

    if(this.isA$ctxComponent){
      this.$ctx["_ctxroot_"] = this
    }
  }
  

  // step 2: build skeleton (html pointer and child), then properties ref
  buildSkeleton(){

    this.buildHtmlPointerElement()

    this.buildPropertiesRef() // bugfix: devo creare ogni $xxx prima di andare in basso nei children..altrimenti il processo di discesa inverte l'esecuzione

    this.buildChildsSkeleton()
  }

  buildHtmlPointerElement(){

    if ( this.isObjComponent ){

      this.html_pointer_element = document.createElement("leobj")
      if( this.meta_options.hasViewChilds ){
        if (this.isMyParentHtmlRoot){
          this.parent.appendChild(this.html_pointer_element)
        }
        else {
          this.parent.html_pointer_element.appendChild(this.html_pointer_element)
        }
      }

    }
    else {

      this.html_pointer_element = document.createElement(this.htmlElementType)

      if (this.isMyParentHtmlRoot){
        this.parent.appendChild(this.html_pointer_element)
      }
      else {
        this.parent.html_pointer_element.appendChild(this.html_pointer_element)
      }

    }

  }

  buildChildsSkeleton(){

    this.childs = (this.convertedDefinition.childs?.map(childTemplate=>Component.componentFactory(this, childTemplate, this.$le, this.$dbus)) || [] )

    this.childs.forEach(child=>child.buildSkeleton())

  }

  buildPropertiesRef(){

    // t.b.d
    this.properties.el = this.html_pointer_element // ha senso??? rischia di spaccare tutto..nella parte di sotto..
    this.properties.parent = this.parent?.$this?.this // ha senso??? rischia di spaccare tutto.. recursive this.parent.parent & parent.parent le.x.parent.. etc..
    this.properties.comp_id = this.id

    // todo: qualcosa del genere per gli attr
    // this.properties.attr = ComponentProxy(this.attrProperties)

    // todo: parent and le visible properties only..
    this.$parent = (this.parent instanceof Component) ? ComponentProxy(this.parent.properties) : undefined
    this.$scope = ComponentScopeProxy(this)
    this.$this = ComponentProxy(/*new ComponentProxySentinel(*/{this: ComponentProxy(this.properties), parent: this.$parent, scope: this.$scope,  le: this.$le.proxy, ctx: this.$ctx.proxy, dbus: this.$dbus.proxy, meta: this.$meta} /*)*/ ) //tmp, removed ComponentProxySentinel (useless)

    // mettere private stuff in "private_properties" e "private_signal", a quel punto una strada potrebbe essere quella di avere un "private_this" qui su..ma in teoria dovrebbe essere qualcosa di context, e non solo in me stesso..
  }

  // step 3: create and renderize
  create(){

    // html event
    if (this.convertedDefinition.handle !== undefined){
      Object.entries(this.convertedDefinition.handle).forEach(([k,v])=>{
        this.html_pointer_element[k] = (...e)=>v.bind(undefined, this.$this, ...e)()
      })
    }

    // first of all: declare all "data" possible property changes handler (in this way ww are sure that exist in the future for deps analysis) - they also decalre a signal!
    if (this.convertedDefinition.data !== undefined){
      Object.entries(this.convertedDefinition.data).forEach(([k,v])=>{

        // Create but do not init
        this.properties[k] = new Property(pass, pass, pass, pass, ()=>this.$this, (thisProp, deps)=>{

          // deps connection logic

          let depsRemover = []

          deps.$this_deps?.forEach(d=>{
            let depRemover = this.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() ) // qui il ? server affinche si ci registri solo alle props (e non alle func etc!)
            depRemover && depsRemover.push(depRemover)
          }) // supporting multiple deps, but only of first order..

          deps.$parent_deps?.forEach(d=>{
            let depRemover = this.parent.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
            depRemover && depsRemover.push(depRemover)
          })

          deps.$scope_deps?.forEach(d=>{
            let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
            let depRemover = (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() ); // qui il ? server affinche si ci registri solo alle props (e non alle func etc!)
            depRemover && depsRemover.push(depRemover)
          }) // supporting multiple deps, but only of first order..


          deps.$le_deps?.forEach(d=>{ // [le_id, property]
            let depRemover = this.$le[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
            depRemover && depsRemover.push(depRemover)
          })

          deps.$ctx_deps?.forEach(d=>{ // [le_id, property]
            let depRemover = this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
            depRemover && depsRemover.push(depRemover)
          })
          
          return depsRemover

        }, false)

        // Create associated Signal -> Every property has an associated signal, fired on change, that we use to notify interested components
        let signalName = k+"Changed" // nomde del segnale che useranno i dev per definirlo nelle on.. name used to store signal
        let manualMarkSignalName = "_mark_"+k+"_as_changed" // nome visible ai dev per marcare manualmente la property come changed
        this.signals[signalName] = new Signal(signalName, "stream => (newValue: any, oldValue: any) - property change signal")
        this.properties[manualMarkSignalName] = ()=>this.properties[k].markAsChanged() // via on set scatenerĂ  il signal etc!
      })
      _info.log("Parsed data definition: ", this, this.signals, this.properties)
    }

    // signals def
    if (this.convertedDefinition.signals !== undefined){
      Object.entries(this.convertedDefinition.signals).forEach(([s,s_def])=>{
        const realSignal = new Signal(s, s_def)
        this.signals[s] = realSignal
        this.properties[s] = Signal.getSignalProxy(realSignal)
      })
      _info.log("Parsed signals definition: ", this, this.signals, this.properties)
    }

    // dbus signals def
    if (this.convertedDefinition.dbus_signals !== undefined){
      Object.entries(this.convertedDefinition.dbus_signals).forEach(([s,s_def])=>{
        const realSignal = this.$dbus.addSignal(s, s_def)
        // this.properties[s] = Signal.getSignalProxy(realSignal)
      })
    }

    // function def // NO DEPS SCAN AT THIS TIME
    if (this.convertedDefinition.def !== undefined){
      Object.entries(this.convertedDefinition.def).forEach(([k,v])=>{
        let _isFunc = isFunction(v)
        if (!_isFunc){ // is a namespace
          this.properties[k] = {}
          Object.entries(v).forEach(([kk,vv])=>{
            this.properties[k][kk] = (...args)=>vv.bind(undefined, this.$this, ...args)()

            let staticDeps = analizeDepsStatically(vv) // TODO: static deps analysis
            this.defDeps[k+"."+kk] = staticDeps

          })
          this.properties[k] = ComponentProxy(this.properties[k]) // maby is a normal obj?? -> to avoid to create a point where user can write without permission
        }
        else{
          this.properties[k] = (...args)=>v.bind(undefined, this.$this, ...args)()

          let staticDeps = analizeDepsStatically(v) // TODO: static deps analysis
          this.defDeps[k] = staticDeps
          
        }
      })
    }

    // on (property) | on_s (signal) def // todo: trigger on inti?
    [this.convertedDefinition.on, this.convertedDefinition.on_s /*, this.convertedDefinition.on_a*/].forEach( handle_on_definition => {
      if (handle_on_definition !== undefined){
        _info.log("Found on/on_s/on_a definition", this)
        Object.entries(handle_on_definition).forEach(([typologyNamespace, defs ])=>{
          if (typologyNamespace === "this"){
            Object.entries(defs).forEach(([s, fun])=>{
              let remover = this.signals[s].addHandler(this, (...args)=>fun.bind(undefined, this.$this, ...args)())
              this.signalsHandlerRemover.push(remover)
            })
          }
          if (typologyNamespace === "parent"){
            Object.entries(defs).forEach(([s, fun])=>{
              let remover = this.parent.signals[s].addHandler(this, (...args)=>fun.bind(undefined, this.$this, ...args)())
              this.signalsHandlerRemover.push(remover)
            })
          }
          if (typologyNamespace === "scope"){
            Object.entries(defs).forEach(([s, fun])=>{
              let remover = this.get$ScopedPropsOwner(s)[0].signals[s].addHandler(this, (...args)=>fun.bind(undefined, this.$this, ...args)())
              this.signalsHandlerRemover.push(remover)
            })
          }
          if (typologyNamespace === "dbus"){
            Object.entries(defs).forEach(([s, fun])=>{
              let remover = this.$dbus.addSignalHandler(s, this, (...args)=>fun.bind(undefined, this.$this, ...args)())
              this.signalsHandlerRemover.push(remover)
            })
          }
          if (typologyNamespace === "le"){
            Object.entries(defs).forEach(([leItem, leItemDefs])=>{ // get requested element name
              Object.entries(leItemDefs).forEach(([s, fun])=>{
                // exponential retry to handle signal
                const setUpSignalHandler = (num_retry=0)=>{
                  try{
                    // _info.log("provo ad agganciare signal", leItem, s)
                    let remover = this.$le[leItem].signals[s].addHandler(this, (...args)=>fun.bind(undefined, this.$this, ...args)())
                    this.signalsHandlerRemover.push(remover)
                  }
                  catch{
                    if (num_retry < 5) {
                      setTimeout(()=>setUpSignalHandler(num_retry++), Math.min(1*(num_retry+1), 5))
                    }
                    else{
                      _warning.log("CLE - WARNING! unable to connect to the signal! -> ", this, defs,)
                    }
                  }
                }
                setUpSignalHandler()
              })
            })
          }
          // todo: fattorizzare con le, se possibile!
          if (typologyNamespace === "ctx"){
            Object.entries(defs).forEach(([ctxItem, ctxItemDefs])=>{ // get requested element name
              Object.entries(ctxItemDefs).forEach(([s, fun])=>{
                // exponential retry to handle signal
                const setUpSignalHandler = (num_retry=0)=>{
                  try{
                    // _info.log("provo ad agganciare signal", leItem, s)
                    let remover = this.$ctx[ctxItem].signals[s].addHandler(this, (...args)=>fun.bind(undefined, this.$this, ...args)())
                    this.signalsHandlerRemover.push(remover)
                  }
                  catch{
                    if (num_retry < 5) {
                      setTimeout(()=>setUpSignalHandler(num_retry++), Math.min(1*(num_retry+1), 5))
                    }
                    else{
                      _warning.log("CLE - WARNING! unable to connect to the signal! -> ", this, defs,)
                    }
                  }
                }
                setUpSignalHandler()
              })
            })
          }
        })
      }
    })
    

    // data, TODO: check deps on set, "cached get", support function etc
    if (this.convertedDefinition.data !== undefined){
      Object.entries(this.convertedDefinition.data).forEach(([k,v])=>{

        // finally init!
        this.properties[k].init(
          v,
          ()=>_debug.log(k, "getted!"), 
          (v, ojV, self)=>{ _debug.log(k, "setted!", this); 
            this.signals[k+"Changed"].emit(v, this.properties[k]._latestResolvedValue);
          },
          //()=>{console.log("TODO: on destroy clear stuff and signal!!")}
        )
        _debug.log("Parser, data initialized: ", this, this.properties)
      })
    }

    // attributes, TODO: support function etc
    if (this.convertedDefinition.attrs !== undefined){
      _debug.log("Found attrs: ", this.convertedDefinition.attrs)

      // let has2WayBinding = Object.values(this.convertedDefinition.attrs).find(v=>v instanceof Binding) !== undefined
      let _2WayPropertyBindingToHandle = {}

      Object.entries(this.convertedDefinition.attrs).forEach(([k,v])=>{
        
        const toExecMabyLazy = (k)=>{
          _debug.log("Parsing attr: ", k,v)

          if (k.includes(".")){ // devo andare a settare l'attr as property dinamicamente [nested!]
            _warning.log("CLE - WARNING! ATTRS does not support '.' property navigation!")
          }
          else {
            if (k === "style"){

              const resolveObjStyle = (o)=> typeof o === "object" ? toInlineStyle(o) : o
              const setupStyle = (s)=>{ 
                let val = isFunction(s) ? s.bind(undefined, this.$this)() : s
                if ((val === null || val === undefined)) { 
                  if(this.html_pointer_element.hasAttribute("style")) { 
                    this.html_pointer_element.removeAttribute("style") 
                  }
                } else { 
                  this.html_pointer_element.setAttribute("style", resolveObjStyle( val ).toString())
                } 
              }

              if (isFunction(v)){
                let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machanism..this wil break deps update in future!!!
                _debug.log("Attr static deps analysis: ", staticDeps)

                staticDeps.$this_deps?.forEach(d=>{
                  this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupStyle(v) ) // questa cosa da rivdere...il who non lo salviam ma in generale ora questa roba deve essere una prop, fully automated!
                }) // supporting multiple deps, but only of first order..

                staticDeps.$parent_deps?.forEach(d=>{
                  this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupStyle(v) )
                })
                
                staticDeps.$scope_deps?.forEach(d=>{
                  let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                  (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler([this, "attr", k], ()=>setupStyle(v) );
                })

                staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                  this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k], ()=>setupStyle(v) )
                })

                staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                  this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k], ()=>setupStyle(v) )
                })

              }
              else {

              }

              setupStyle(v)

            } 
            else if (isFunction(v)){
                const setupValue = ()=>{ 
                  const val = v.bind(undefined, this.$this)(); 
                  if ((val === null || val === undefined)) { 
                    if (this.html_pointer_element.hasAttribute(k)) { 
                      this.html_pointer_element.removeAttribute(k)
                    }
                  } else { 
                    this.html_pointer_element.setAttribute(k, val.toString())
                  } 
                }

                let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
                _debug.log("Attr static deps analysis: ", staticDeps)

                staticDeps.$this_deps?.forEach(d=>{
                  this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                }) // supporting multiple deps, but only of first order..

                staticDeps.$parent_deps?.forEach(d=>{
                  this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                })
                
                staticDeps.$scope_deps?.forEach(d=>{
                  let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                  (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler([this, "attr", k], ()=>setupValue() );
                })

                staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                  this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                })

                staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                  this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                })

                setupValue()

            }
            else if (v instanceof Binding){ 
              _info.log("Found Binding attr: ", k,v, this)

              const _binding = v;
              v = v.bindFunc

              const setupValue = ()=>{ 
                const val = v.bind(undefined, this.$this)(); 
                if (val !== this.html_pointer_element[k]){ //set only if different!
                  this.html_pointer_element[k] = val?.toString()
                }
                
              }

              let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
              _info.log("Attr static deps analysis: ", staticDeps)
              // todo: in realtĂ  Ă¨ mutualmente escusivo, e solo 1 dep il property binding!
              staticDeps.$this_deps?.forEach(d=>{
                this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.properties[d]
              }) 

              staticDeps.$parent_deps?.forEach(d=>{
                this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.parent.properties[d]
              })
              
              staticDeps.$scope_deps?.forEach(d=>{
                let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                if (isPropertiesProp){
                  propsOwner.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                  _2WayPropertyBindingToHandle[k] = ()=>propsOwner.properties[d]
                }
                else {
                  propsOwner.meta[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                  _2WayPropertyBindingToHandle[k] = ()=>propsOwner.meta[d]
                }
              })

              staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.$le[d[0]].properties[d[1]]
              })

              staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.$ctx[d[0]].properties[d[1]]
              })

              // now manually configure the binding
              if ((this.htmlElementType === "input" || this.htmlElementType === "div") && ["value", "checked"].includes(k)){
                if ( ( ! ["button", "hidden", "image", "reset", "submit", "file"].includes(this.convertedDefinition.attrs.type)) ){
                  _info.log("Found 2 way binding", k, this)
                  let handlerFor2WayDataBinding = (e)=>{ 
                    _info.log("2way binding changes handled!")
                    // e.stopPropagation(); 
                    let bindedProps = _2WayPropertyBindingToHandle[k]()
                    let newValue = _binding.remap !== undefined ? _binding.remap.bind(undefined, this.$this)(e.target[k], e) : e.target[k]
                    if(bindedProps.value !== newValue) {
                      bindedProps.value = newValue
                    }
                  }
                  _info.log("2way Chose event: ", _binding.event ?? "input", k, this)
                  this.html_pointer_element.addEventListener(_binding.event ?? "input", handlerFor2WayDataBinding)
                  let remover = ()=>this.html_pointer_element.removeEventListener(_binding.event ?? "input", handlerFor2WayDataBinding) // per la destroy..
                  this.signalsHandlerRemover.push(remover)
                }
              }
              else if(this.htmlElementType === "textarea"){
                // todo..in realtĂ  basta anche qui oninput e accedere a .value ...in alternativa textContent.. ma qui ho il problema che non so ancora come settare il valore..visto che in realtĂ  useri text e quindi i child..
              }
              else if(this.htmlElementType === "select" && k === 'value' && this.convertedDefinition.attrs.multiple === undefined){ // todo: multiple is not supported at this time.. https://stackoverflow.com/questions/11821261/how-to-get-all-selected-values-from-select-multiple-multiple
                let handlerFor2WayDataBinding = (e)=>{ 
                  // e.stopPropagation(); 
                  let bindedProps = _2WayPropertyBindingToHandle[k]()
                  let newValue = _binding.remap !== undefined ? _binding.remap.bind(undefined, this.$this)(e.target[k], e) : e.target[k]
                  if(bindedProps.value !== newValue) {
                    bindedProps.value = newValue 
                  }
                }
                this.html_pointer_element.addEventListener(_binding.event ?? "change", handlerFor2WayDataBinding)
                let remover = ()=>this.html_pointer_element.removeEventListener(_binding.event ?? "change", handlerFor2WayDataBinding) // per la destroy..
                this.signalsHandlerRemover.push(remover)
              
              }
              else if(this.htmlElementType === "details" && k === "open"){
                // todo
              }

              setupValue()

            }
            else {
              if ((v === null || v === undefined)) { 
                if (this.html_pointer_element.hasAttribute(k)) { 
                  this.html_pointer_element.removeAttribute(k) 
                }
              } else { 
                this.html_pointer_element.setAttribute(k, v.toString())
              } 
            }
          }

        }

        if (k.startsWith("@lazy:")){
          _info.log("Found lazy attr!")
          setTimeout(()=>toExecMabyLazy(k.replace("@lazy:", "")), 10)
        }
        else {
          toExecMabyLazy(k)
        }

      })

    }


    // attributes, TODO: support function etc
    if (this.convertedDefinition.hattrs !== undefined){
      _debug.log("Found hattrs: ", this.convertedDefinition.hattrs)

      let _2WayPropertyBindingToHandle = {}

      Object.entries(this.convertedDefinition.hattrs).forEach(([k,v])=>{
        
        const toExecMabyLazy = (k)=>{

          
          _debug.log("Exec HAttr: ", k,v)

          let _oj_k = k

          if (k.includes(".")){ // devo andare a settare l'attr as property dinamicamente [nested!]

            if (isFunction(v)){
              const setupValue = ()=>{ 
                let [pointer, final_k] = recursiveAccessor(this.html_pointer_element, k.split("."))

                const val = v.bind(undefined, this.$this)(); 
                
                pointer[final_k] = val
              }

              let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
              _info.log("HAttr static deps analysis: ", staticDeps)

              staticDeps.$this_deps?.forEach(d=>{
                this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              }) // supporting multiple deps, but only of first order..

              staticDeps.$parent_deps?.forEach(d=>{
                this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              })

              staticDeps.$scope_deps?.forEach(d=>{
                let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler([this, "attr", k], ()=>setupValue() );
              })

              staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              })

              staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              })

              setupValue()

            }
            else if (v instanceof Binding){ 
              _info.log("Found binding hattr: ", k,v, this)

              const _binding = v;
              v = v.bindFunc

              const setupValue = ()=>{ 
                let [pointer, final_k] = recursiveAccessor(this.html_pointer_element, k.split("."))
                const val = v.bind(undefined, this.$this)(); 
                if (val !== this.html_pointer_element[k]){ //set only if different!
                  pointer[final_k] = val
                }
              }

              let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
              _info.log("HAttr static deps analysis: ", staticDeps)
              // todo: in realtĂ  Ă¨ mutualmente escusivo, e solo 1 dep il property binding!
              staticDeps.$this_deps?.forEach(d=>{
                this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.properties[d]
              }) 

              staticDeps.$parent_deps?.forEach(d=>{
                this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.parent.properties[d]
              })

              staticDeps.$scope_deps?.forEach(d=>{
                let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                if (isPropertiesProp){
                  propsOwner.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                  _2WayPropertyBindingToHandle[k] = ()=>propsOwner.properties[d]
                }
                else {
                  propsOwner.meta[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                  _2WayPropertyBindingToHandle[k] = ()=>propsOwner.meta[d]
                }
              })

              staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.$le[d[0]].properties[d[1]]
              })

              staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>this.$ctx[d[0]].properties[d[1]]
              })


              // now manually configure the binding
              _info.log("Exec 2 way bidning", k, this)
              let handlerFor2WayDataBinding = (e)=>{ 
                _info.log("2way binding changes handled!")
                // e.stopPropagation(); 
                let bindedProps = _2WayPropertyBindingToHandle[k]()

                let [pointer, final_k] = recursiveAccessor(e.target, k.split("."))

                let newValue = _binding.remap !== undefined ? _binding.remap.bind(undefined, this.$this)(pointer[final_k], e) : pointer[final_k]
                if(bindedProps.value !== newValue) {
                  bindedProps.value = newValue
                }
              }
              _info.log("Chosing event: ", _binding.event ?? "input", k, this)
              this.html_pointer_element.addEventListener(_binding.event ?? "input", handlerFor2WayDataBinding)
              let remover = ()=>this.html_pointer_element.removeEventListener(_binding.event ?? "input", handlerFor2WayDataBinding) // per la destroy..
              this.signalsHandlerRemover.push(remover)

              setupValue()

            }
            else {
              let [pointer, final_k] = recursiveAccessor(this.html_pointer_element, k.split("."))
              pointer[final_k] = v
            }

          }
          else if (isFunction(v)){
              const setupValue = ()=>{ 
                this.html_pointer_element[k] = v.bind(undefined, this.$this)(); 
              }

              let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
              _info.log("HAttr static deps analysis: ", staticDeps)

              staticDeps.$this_deps?.forEach(d=>{
                this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              }) // supporting multiple deps, but only of first order..

              staticDeps.$parent_deps?.forEach(d=>{
                this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              })

              staticDeps.$scope_deps?.forEach(d=>{
                let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
                (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler([this, "attr", k], ()=>setupValue() );
              })

              staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
                this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              })

              staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
                this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              })

              setupValue()

          }
          else if (v instanceof Binding){ 
            _info.log("Found binding hattr: ", k,v, this)

            const _binding = v;
            v = v.bindFunc

            const setupValue = ()=>{ 
              const val = v.bind(undefined, this.$this)(); 
              if (val !== this.html_pointer_element[k]){ //set only if different!
                this.html_pointer_element[k] = val
              }
              
            }

            let staticDeps = analizeDepsStatically(v) // WARNING actally w're bypassing the "deps storage" machenism..this wil break deps update in future!!!
            _info.log("hattr static deps analysis: ", staticDeps)
            // todo: in realtĂ  Ă¨ mutualmente escusivo, e solo 1 dep il property binding!
            staticDeps.$this_deps?.forEach(d=>{
              this.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              _2WayPropertyBindingToHandle[k] = ()=>this.properties[d]
            }) 

            staticDeps.$parent_deps?.forEach(d=>{
              this.parent.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
              _2WayPropertyBindingToHandle[k] = ()=>this.parent.properties[d]
            })

            staticDeps.$scope_deps?.forEach(d=>{
              let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
              if (isPropertiesProp){
                propsOwner.properties[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>propsOwner.properties[d]
              }
              else {
                propsOwner.meta[d]?.addOnChangedHandler([this, "attr", k], ()=>setupValue() )
                _2WayPropertyBindingToHandle[k] = ()=>propsOwner.meta[d]
              }
            })
            
            staticDeps.$le_deps?.forEach(d=>{ // [le_id, property]
              this.$le[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              _2WayPropertyBindingToHandle[k] = ()=>this.$le[d[0]].properties[d[1]]
            })

            staticDeps.$ctx_deps?.forEach(d=>{ // [ctx_id, property]
              this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler([this, "attr", k],  ()=>setupValue() )
              _2WayPropertyBindingToHandle[k] = ()=>this.$ctx[d[0]].properties[d[1]]
            })


            // now manually configure the binding
            _info.log("Exec 2 way bidning", k, this)
            let handlerFor2WayDataBinding = (e)=>{ 
              _info.log("2way binding changes handled!")
              // e.stopPropagation(); 
              let bindedProps = _2WayPropertyBindingToHandle[k]()
              let newValue = _binding.remap !== undefined ? _binding.remap.bind(undefined, this.$this)(e.target[k], e) : e.target[k]
              if(bindedProps.value !== newValue) {
                bindedProps.value = newValue
              }
            }
            _info.log("Chosing event: ", _binding.event ?? "input", k, this)
            this.html_pointer_element.addEventListener(_binding.event ?? "input", handlerFor2WayDataBinding)
            let remover = ()=>this.html_pointer_element.removeEventListener(_binding.event ?? "input", handlerFor2WayDataBinding) // per la destroy..
            this.signalsHandlerRemover.push(remover)
          


            setupValue()

          }
          else {
            this.html_pointer_element[k] = v 
          }

        }

        if (k.startsWith("@lazy:")){
          _info.log("Found lazy!")
          setTimeout(()=>toExecMabyLazy(k.replace("@lazy:", "")), 10)
        }
        else {
          toExecMabyLazy(k)
        }
      })
    }


    // css, TODO: support function etc. occhio 
    if (this.convertedDefinition.css !== undefined){
      if (this.css_html_pointer_element === undefined){
        this.css_html_pointer_element = document.createElement('style');
        document.getElementsByTagName('head')[0].appendChild(this.css_html_pointer_element);
      }

      let rules = []
      
      const renderize_css = ()=>{
        this.css_html_pointer_element.innerText = rules.map(r=>r.value.replaceAll("\n", "").replaceAll("\t", " ").replaceAll("   ", "").replaceAll("  ", " ")).join(" ")
      }

      (Array.isArray(this.convertedDefinition.css) ? 
        this.convertedDefinition.css 
        :
        Object.values(this.convertedDefinition.css)
      ).forEach(rule=>{
        rules.push(
          
          new Property(rule, none, renderize_css, none, ()=>this.$this, (thisProp, deps)=>{
                  
            let depsRemover = []

            // deps connection logic
            deps.$this_deps?.forEach(d=>{
              let depRemover = this.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() ) // qui il ? server affinche si ci registri solo alle props (e non alle func etc!)
              depRemover && depsRemover.push(depRemover)
            }) // supporting multiple deps, but only of first order..

            deps.$parent_deps?.forEach(d=>{
              let depRemover = this.parent.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
              depRemover && depsRemover.push(depRemover)
            })

            deps.$scope_deps?.forEach(d=>{
              let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
              let depRemover = (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() );
              depRemover && depsRemover.push(depRemover)
            })

            deps.$le_deps?.forEach(d=>{ // [le_id, property]
              let depRemover = this.$le[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
              depRemover && depsRemover.push(depRemover)
            })

            deps.$ctx_deps?.forEach(d=>{ // [le_id, property]
              let depRemover = this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
              depRemover && depsRemover.push(depRemover)
            })
            return depsRemover
          }, true)
        )
      })

      renderize_css()

    }



    // constructor (if is a use component)
    if (this.isA$ctxComponent && this.convertedDefinition.constructor !== undefined){
      let args = {}
      if (this.oj_definition.init !== undefined){
        Object.entries(this.oj_definition.init).forEach(([p, v])=>{
          args[p] = isFunction(v) ? v.bind(undefined, this.parent.$this) : v // todo: questo Ă¨ un mezzo errore..perchĂ¨ in questo modo non ruisciro a parsare le dipendenze nel caso di set di una prop..perchĂ¨ Ă¨ giĂ  bindata! d'altro canto in realtĂ  init nasce per passare valori, quindi Ă¨ corretto!
          // todo: forse la cosa migliore qui Ă¨ abbandonare l'idea del constructor e andare con i passed args, ovvero lato declaration giĂ  indico a chi assegno cosa, mettendo una prop nel mezzo con punto di vista "parent" ma nel figlio, in modo da notifcare i changes!
          // todo: o meglio, forse basta che creo una prop con exec context del parent in loop come questo (ma dedicato ai passed), e agganciarci alla onChange una semplicissima mark as changed della prop (this) che conterrĂ  quella passata (del parent)
        })
      }
      this.hooks.constructor = this.convertedDefinition.constructor.bind(undefined, this.$this, args)
    }

    // onInit
    if (this.convertedDefinition.onInit !== undefined){
      this.hooks.onInit = this.convertedDefinition.onInit.bind(undefined, this.$this)
    }

    // afterChildsInit (non lazy!)
    if (this.convertedDefinition.afterChildsInit !== undefined){
      this.hooks.afterChildsInit = this.convertedDefinition.afterChildsInit.bind(undefined, this.$this)
    }

    // afterInit
    if (this.convertedDefinition.afterInit !== undefined){
      this.hooks.afterInit = this.convertedDefinition.afterInit.bind(undefined, this.$this)
    }

    // onUpdate
    if (this.convertedDefinition.onUpdate !== undefined){
      this.hooks.onUpdate = this.convertedDefinition.onUpdate.bind(undefined, this.$this)
    }

    // onDestroy
    if (this.convertedDefinition.onDestroy !== undefined){
      this.hooks.onDestroy = this.convertedDefinition.onDestroy.bind(undefined, this.$this)
    }


    // trigger constructor (if is a component)
    this.isA$ctxComponent && this.convertedDefinition.constructor !== undefined && this.hooks.constructor()

    // trigger init
    this.hooks.onInit !== undefined && this.hooks.onInit()

    // create childs
    for (let _child of this.childs){
      _child.create()
    }

    // afterChildsInit (non lazy!)
    this.hooks.afterChildsInit !== undefined && this.hooks.afterChildsInit()

    // trigger afterInit (lazy..)
    this.hooks.afterInit !== undefined && setTimeout(()=>this.hooks.afterInit(), 1)

  }
  // update(){
  //   this.childs.forEach(child=>child.update())
  // }
  // regenerate(){}
  destroy(){
    this.childs?.forEach(child=>child.destroy())

    this.hooks.onDestroy !== undefined && this.hooks.onDestroy()
    
    this.html_pointer_element?.remove()
    this.css_html_pointer_element?.remove()
    this.css_html_pointer_element=undefined
    try { delete this.$ctx[this.id] } catch {}
    try { delete this.$ctx[this._id] } catch {}
    try { if(this.isMyParentHtmlRoot){ delete this.$le["_root_"] } } catch {}
    try { if(this.isA$ctxComponent){ delete this.$ctx["_ctxroot_"] } } catch {}
    delete this.$le[this.id]

    Object.values(this.signals).forEach(s=>{
      try{s.destroy()} catch{}
    })
    Object.values(this.signalsHandlerRemover).forEach(remover=>{
      try{remover()} catch{}
    })
    Object.values(this.properties).forEach(p=>{
      try{p.destroy(true)} catch{}
    })

    // todo: destroy properties and signal well..

  }

  static parseComponentDefinition = (definition) => {
    let unifiedDef = { }


    // multi choice def

    let { childs, contains: childs_contains, text: childs_text, ">>":childs_ff, "=>": childs_arrow, _: childs_underscore, '': childs_empty } = definition
    unifiedDef.childs = childs || childs_contains || childs_text || childs_ff || childs_arrow || childs_underscore || childs_empty
    if (unifiedDef.childs !== undefined && !Array.isArray(unifiedDef.childs)) {unifiedDef.childs = [unifiedDef.childs]}
    // can be: template | string | $ => string | array<template | string | $ => string>


    // standard def

    unifiedDef.state = definition.state || "initial"

    copyObjPropsInplace(definition, unifiedDef, [
      "constructor", 
      "beforeInit", "onInit", "afterInit", "afterChildsInit", "onUpdate", "onDestroy", 
      "signals", "dbus_signals", "on", "on_s", "on_a", 
      "alias", "handle", "css", 
      "states", "stateChangeStrategy", "onState"
    ])



    // maybe private def

    let { 
      id, ctx_id: _id, 
      def, "private:def": _def, 
      attrs, "private:attrs":_attrs, 
      a, "private:a": _a, 
      hattrs, "private:hattrs":_hattrs, 
      ha, "private:ha": _ha, 
    } = definition

    unifiedDef.id = id || ComponentRUUIDGen.generate()
    unifiedDef._id = _id || unifiedDef.id

    if (def !== undefined) { unifiedDef.def = def }
    if (_def !== undefined) { unifiedDef._def = _def }
    
    if (attrs !== undefined || a !== undefined) { unifiedDef.attrs = attrs || a }
    if (_attrs !== undefined || _a !== undefined) { unifiedDef._attrs = _attrs || _a }

    if (hattrs !== undefined || ha !== undefined) { unifiedDef.hattrs = hattrs || ha }
    if (_hattrs !== undefined || _ha !== undefined) { unifiedDef._hattrs = _hattrs || _ha }

    // a/ha & attrs/hattrs 1st lvl shortcuts: (eg: a.style or attrs.style) -> only public for nuw!
    let attrs_shortcuts_key = Object.keys(definition).filter(k=>k.startsWith("a.") || k.startsWith("attrs."))

    if (attrs_shortcuts_key.length > 0){
      let attrs_shortcuts_definition = {}
      attrs_shortcuts_key.forEach(sk=>{ attrs_shortcuts_definition[sk.split(".")[1]] = definition[sk] })
      if (unifiedDef.attrs !== undefined){
        unifiedDef.attrs = { ...unifiedDef.attrs, ...attrs_shortcuts_definition }
      }
      else {
        unifiedDef.attrs = attrs_shortcuts_definition
      }
    }

    let hattrs_shortcuts_key = Object.keys(definition).filter(k=>k.startsWith("ha.") || k.startsWith("hattrs."))
    if (hattrs_shortcuts_key.length > 0){
      let hattrs_shortcuts_definition = {}
      hattrs_shortcuts_key.forEach(sk=>{let new_sk = sk.split("."); new_sk.shift(); new_sk=new_sk.join("."); hattrs_shortcuts_definition[new_sk] = definition[sk] })
      if (unifiedDef.hattrs !== undefined){
        unifiedDef.hattrs = { ...unifiedDef.hattrs, ...hattrs_shortcuts_definition }
      }
      else {
        unifiedDef.hattrs = hattrs_shortcuts_definition
      }
    }

    
    // maybe private def and multichoice

    let { 
      data, "private:data": _data, 
      props, "private:props": _props, 
      "let": data_let, "private:let": _data_let, 
    } = definition

    unifiedDef.data = data || props || data_let || {}
    unifiedDef._data = _data || _props || _data_let || {}


    const dash_shortucts_keys = {
      attrs: {},
      hattrs: {},
      data: {},
      def: {},
      handle: {},
      signals: {},
      dbus_signals: {},
      on_this: {},
      on_parent: {},
      on_scope: {},
      on_dbus: {},
      // on_le: {}, // TODO: support on le & ctx shortcuts!
      // on_ctx: {},
    }

    // let has_dash_shortucts_keys = false // todo performance by skip next if series

    Object.keys(definition).forEach(k=>{
      if (k.includes("_")){

        let val = definition[k]

        if (k.startsWith('a_')){
          dash_shortucts_keys.attrs[k.substring(2)] = val
        }
        else if (k.startsWith('attr_')){
          dash_shortucts_keys.attrs[k.substring(5)] = val
        }

        else if (k.startsWith('ha_')){
          dash_shortucts_keys.hattrs[k.substring(3)] = val
        }
        else if (k.startsWith('hattr_')){
          dash_shortucts_keys.hattrs[k.substring(6)] = val
        }
        
        else if (k.startsWith('p_')){
          dash_shortucts_keys.data[k.substring(2)] = val
        }
        else if (k.startsWith('let_')){
          dash_shortucts_keys.data[k.substring(4)] = val
        }

        else if (k.startsWith('d_')){
          dash_shortucts_keys.def[k.substring(2)] = val
        }
        else if (k.startsWith('def_')){
          dash_shortucts_keys.def[k.substring(4)] = val
        }

        else if (k.startsWith('h_')){
          dash_shortucts_keys.handle[k.substring(2)] = val
        }
        else if (k.startsWith('handle_')){
          dash_shortucts_keys.handle[k.substring(7)] = val
        }
        
        else if (k.startsWith('s_')){
          dash_shortucts_keys.signals[k.substring(2)] = val
        }
        else if (k.startsWith('signal_')){
          dash_shortucts_keys.signals[k.substring(7)] = val
        }
        
        else if (k.startsWith('dbs_')){
          dash_shortucts_keys.dbus_signals[k.substring(4)] = val
        }
        else if (k.startsWith('dbus_signal_')){
          dash_shortucts_keys.dbus_signals[k.substring(12)] = val
        }

        else if (k.startsWith('on_this_')){
          dash_shortucts_keys.on_this[k.substring(8)] = val
        }
        else if (k.startsWith('on_parent_')){
          dash_shortucts_keys.on_parent[k.substring(10)] = val
        }
        else if (k.startsWith('on_scope_')){
          dash_shortucts_keys.on_scope[k.substring(9)] = val
        }
        else if (k.startsWith('on_dbus_')){
          dash_shortucts_keys.on_dbus[k.substring(8)] = val
        }
      }
    })

    if (Object.keys(dash_shortucts_keys.attrs).length > 0){
      if (unifiedDef.attrs !== undefined){ unifiedDef.attrs = { ...unifiedDef.attrs, ...dash_shortucts_keys.attrs } }
      else { unifiedDef.attrs = dash_shortucts_keys.attrs }
    }
    if (Object.keys(dash_shortucts_keys.hattrs).length > 0){
      if (unifiedDef.hattrs !== undefined){ unifiedDef.hattrs = { ...unifiedDef.hattrs, ...dash_shortucts_keys.hattrs } }
      else { unifiedDef.hattrs = dash_shortucts_keys.hattrs }
    }
    if (Object.keys(dash_shortucts_keys.data).length > 0){
      if (unifiedDef.data !== undefined){ unifiedDef.data = { ...unifiedDef.data, ...dash_shortucts_keys.data } }
      else { unifiedDef.data = dash_shortucts_keys.data }
    }
    if (Object.keys(dash_shortucts_keys.def).length > 0){
      if (unifiedDef.def !== undefined){ unifiedDef.def = { ...unifiedDef.def, ...dash_shortucts_keys.def } }
      else { unifiedDef.def = dash_shortucts_keys.def }
    }
    if (Object.keys(dash_shortucts_keys.handle).length > 0){
      if (unifiedDef.handle !== undefined){ unifiedDef.handle = { ...unifiedDef.handle, ...dash_shortucts_keys.handle } }
      else { unifiedDef.handle = dash_shortucts_keys.handle }
    }
    if (Object.keys(dash_shortucts_keys.signals).length > 0){
      if (unifiedDef.signals !== undefined){ unifiedDef.signals = { ...unifiedDef.signals, ...dash_shortucts_keys.signals } }
      else { unifiedDef.signals = dash_shortucts_keys.signals }
    }
    if (Object.keys(dash_shortucts_keys.dbus_signals).length > 0){
      if (unifiedDef.dbus_signals !== undefined){ unifiedDef.dbus_signals = { ...unifiedDef.dbus_signals, ...dash_shortucts_keys.dbus_signals } }
      else { unifiedDef.dbus_signals = dash_shortucts_keys.dbus_signals }
    }
    if (Object.keys(dash_shortucts_keys.on_this).length > 0){
      if (unifiedDef.on !== undefined){ 
        if (unifiedDef.on.this !== undefined){
          unifiedDef.on.this = { ...unifiedDef.on.this, ...dash_shortucts_keys.on_this } 
        }
        else {
          unifiedDef.on.this = dash_shortucts_keys.on_this
        }
        
      }
      else { unifiedDef.on = { this: dash_shortucts_keys.on_this }}
    }
    if (Object.keys(dash_shortucts_keys.on_parent).length > 0){
      if (unifiedDef.on !== undefined){ 
        if (unifiedDef.on.parent !== undefined){
          unifiedDef.on.parent = { ...unifiedDef.on.parent, ...dash_shortucts_keys.on_parent } 
        }
        else {
          unifiedDef.on.parent = dash_shortucts_keys.on_parent
        }
        
      }
      else { unifiedDef.on = { parent: dash_shortucts_keys.on_parent }}
    }
    if (Object.keys(dash_shortucts_keys.on_scope).length > 0){
      if (unifiedDef.on !== undefined){ 
        if (unifiedDef.on.scope !== undefined){
          unifiedDef.on.scope = { ...unifiedDef.on.scope, ...dash_shortucts_keys.on_scope } 
        }
        else {
          unifiedDef.on.scope = dash_shortucts_keys.on_scope
        }
        
      }
      else { unifiedDef.on = { scope: dash_shortucts_keys.on_scope }}
    }
    if (Object.keys(dash_shortucts_keys.on_dbus).length > 0){
      if (unifiedDef.on !== undefined){ 
        if (unifiedDef.on.dbus !== undefined){
          unifiedDef.on.dbus = { ...unifiedDef.on.dbus, ...dash_shortucts_keys.on_dbus } 
        }
        else {
          unifiedDef.on.dbus = dash_shortucts_keys.on_dbus
        }
        
      }
      else { unifiedDef.on = { dbus: dash_shortucts_keys.on_dbus }}
    }

    let {meta} = definition

    unifiedDef.meta = meta


    return unifiedDef

  }

  // step 0: Analyze, convert and Create
  static componentFactory = (parent, template, $le, $dbus) => {

    let component;

    if ((typeof template === "string") || (typeof template === "function")){
      component = new TextNodeComponent(parent, template)
      return component
    }

    _info.log("Component Factory: ", parent, template)
    let componentType = getComponentType(template)
    let componentDef = (template instanceof UseComponentDeclaration ? template.computedTemplate : template) [componentType]

    // support smart component natively! must recreate template
    if ((typeof componentDef === "string") || (typeof componentDef === "function") || Array.isArray(componentDef)){
      componentDef = {text: componentDef}
      template = {[componentType]: componentDef}
    }


    if("meta" in componentDef){
      if ("if" in componentDef.meta){ // is a conditionalComponet
        component = new ConditionalComponent(parent, template, $le, $dbus)
      }
      else if ("swich" in componentDef.meta){ // is a switchConditionalComponent
        component = new SwitchConditionalComponent(parent, template, $le, $dbus)
      }
      else if ("forEach" in componentDef.meta) { // is a foreach component (IterableViewComponent)
        component = new IterableViewComponent(parent, template, $le, $dbus)

      }
      else {
        component = new Component(parent, template, $le, $dbus)
      }
    }
    else {
      component = new Component(parent, template, $le, $dbus)
    }
  
    return component
  }
  
}

class TextNodeComponent {

  html_pointer_element
  definition
  parent

  // step 1: build
  constructor(parent, definition){
    this.parent = parent

    this.definition = definition
  }


  // step 2: build skeleton (html pointer)
  buildSkeleton(){

    this.buildHtmlPointerElement()

  }

  buildHtmlPointerElement(){

    this.html_pointer_element = document.createTextNode("")
    this.parent.html_pointer_element.appendChild(this.html_pointer_element)

  }

  _renderizeText(){
    this.html_pointer_element.textContent = isFunction(this.definition) ? this.definition.bind(undefined, this.parent.$this)() : this.definition
  }
  
  depsRemover = []
  staticAnDeps = {} // TEST, DEMO
  analizeDeps(){
    if (typeof this.definition === "function"){
      this.staticAnDeps = analizeDepsStatically(this.definition)
      _debug.log("Text Deps Analysis: ", this, this.staticAnDeps)
    }

  }
  // step 3: create and renderize
  create(){
    
    this.analizeDeps()
    _debug.log("Text Node Created!")

    // todo: fattorizzare perchĂ¨ cosĂ¬ non ha senso..

    // todo: questo bugfix va anche da altre parti // aka il d[0] : d..questo mappa il problema della parent chian lato dev!
    this.staticAnDeps.$this_deps?.forEach(d=>{
      let propName = Array.isArray(d) ? d[0] : d
      let pointedProp = this.parent.properties[propName]
      if ("addOnChangedHandler" in pointedProp){
        this.depsRemover.push(pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
      }
      else if (propName in this.parent.defDeps){ // is a function!
        let staticDeps = this.parent.defDeps[propName]
        let pointedComponentEl = this.parent
        
        staticDeps.$this_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$parent_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.parent.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
        
        staticDeps.$scope_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d

          let [propsOwner, isPropertiesProp] = pointedComponentEl.get$ScopedPropsOwner(d);
          let _pointedProp  = isPropertiesProp ? propsOwner.properties[_propName] : propsOwner.meta[_propName];

          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$le_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$le[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$ctx_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$ctx[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
      }
    })

    this.staticAnDeps.$parent_deps?.forEach(d=>{
      let propName = Array.isArray(d) ? d[0] : d
      let pointedProp = this.parent.parent.properties[propName]
      if ("addOnChangedHandler" in pointedProp){
        this.depsRemover.push(pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
      }
      else if (propName in this.parent.parent.defDeps){ // is a function!
        let staticDeps = this.parent.parent.defDeps[propName]
        let pointedComponentEl = this.parent.parent
        
        staticDeps.$this_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$parent_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.parent.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$scope_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d

          let [propsOwner, isPropertiesProp] = pointedComponentEl.get$ScopedPropsOwner(d);
          let _pointedProp  = isPropertiesProp ? propsOwner.properties[_propName] : propsOwner.meta[_propName];

          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$le_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$le[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$ctx_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$ctx[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
      }
    })    
    
    this.staticAnDeps.$scope_deps?.forEach(d=>{
      let propName = Array.isArray(d) ? d[0] : d
      let [pointedScope, isPropertiesProp] = this.parent.get$ScopedPropsOwner(propName);
      let pointedProp  = isPropertiesProp ? pointedScope.properties[propName] : pointedScope.meta[propName];
      if ("addOnChangedHandler" in pointedProp){
        this.depsRemover.push(pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
      }
      else if (propName in pointedScope.defDeps){ // is a function!
        let staticDeps = pointedScope.defDeps[propName]
        let pointedComponentEl = pointedScope
        
        staticDeps.$this_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$parent_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.parent.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
        
        staticDeps.$scope_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d

          let [propsOwner, isPropertiesProp] = pointedComponentEl.get$ScopedPropsOwner(d);
          let _pointedProp  = isPropertiesProp ? propsOwner.properties[_propName] : propsOwner.meta[_propName];

          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$le_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$le[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$ctx_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$ctx[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
      }
    })

    this.staticAnDeps.$le_deps?.forEach(d=>{
      let propName = d[1]
      let pointedProp = this.parent.$le[d[0]].properties[propName]
      if ("addOnChangedHandler" in pointedProp){
        this.depsRemover.push(pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
      }
      else if (propName in this.parent.$le[d[0]].defDeps){ // is a function!
        let staticDeps = this.parent.$le[d[0]].defDeps[propName]
        let pointedComponentEl = this.parent.$le[d[0]]
        
        staticDeps.$this_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$parent_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.parent.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$scope_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d

          let [propsOwner, isPropertiesProp] = pointedComponentEl.get$ScopedPropsOwner(d);
          let _pointedProp  = isPropertiesProp ? propsOwner.properties[_propName] : propsOwner.meta[_propName];

          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$le_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$le[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$ctx_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$ctx[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
      }
    })

    this.staticAnDeps.$ctx_deps?.forEach(d=>{
      let propName = d[1]
      let pointedProp = this.parent.$ctx[d[0]].properties[propName]
      if ("addOnChangedHandler" in pointedProp){
        this.depsRemover.push(pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
      }
      else if (propName in this.parent.$ctx[d[0]].defDeps){ // is a function!
        let staticDeps = this.parent.$ctx[d[0]].defDeps[propName]
        let pointedComponentEl = this.parent.$ctx[d[0]]
        
        staticDeps.$this_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$parent_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d
          let _pointedProp = pointedComponentEl.parent.properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$scope_deps?.forEach(_d=>{
          let _propName = Array.isArray(_d) ? _d[0] : _d

          let [propsOwner, isPropertiesProp] = pointedComponentEl.get$ScopedPropsOwner(d);
          let _pointedProp  = isPropertiesProp ? propsOwner.properties[_propName] : propsOwner.meta[_propName];
          
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$le_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$le[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })

        staticDeps.$ctx_deps?.forEach(_d=>{
          let _propName = _d[1]
          let _pointedProp = pointedComponentEl.$ctx[_d[0]].properties[_propName]
          if ("addOnChangedHandler" in _pointedProp){
            this.depsRemover.push(_pointedProp.addOnChangedHandler(this, ()=>this._renderizeText()))
          }
          // todo: recoursive def deps!
        })
      }
    })

    this._renderizeText()
    
  }

  // update(){
  //   this.childs.forEach(child=>child.update())
  // }

  // regenerate(){}
  destroy(){
    this.html_pointer_element.remove()
    this.depsRemover?.forEach(dr=>dr())
    // todo: optimization: on destroy i must unsubscribe from deps!
  }

}



class ConditionalComponent extends Component{
  visible = false

  html_pointer_element_anchor

  constructor(...args){
    super(...args)

  }

  // generate the comment/anchor for the real conditional element (that will be create "after" the anchor)
  buildHtmlPointerElementAnchor(){
    
    this.html_pointer_element_anchor = document.createComment("le-if")

    if (this.isMyParentHtmlRoot){
      this.parent.appendChild(this.html_pointer_element_anchor)
    }
    else {
      this.parent.html_pointer_element.appendChild(this.html_pointer_element_anchor)
    }
  }

  // overwrite to do not execut during creation..execpt for the generation of the "anchor", a pointer in the DOOM where we inserte later the real node (if condition is meet)
  // @overwrite
  buildSkeleton(){  this.buildHtmlPointerElementAnchor()  }
  // @overwrite
  buildChildsSkeleton(){ }

  // overwrite to insert the real component after the "anchor", instead of the "append" on child
  // @overwrite
  buildHtmlPointerElement(){

    if ( this.isObjComponent ){

      this.html_pointer_element = document.createElement("leobj")

      if( this.meta_options.hasViewChilds ){
        
        this.html_pointer_element_anchor.after(this.html_pointer_element)
      }

    }
    else {

      this.html_pointer_element = document.createElement(this.htmlElementType)

      this.html_pointer_element_anchor.after(this.html_pointer_element)

      _info.log("Created after comment anchor!")

    }

  }

  // real "create", wrapped in the conditional system
  _create(){
    _info.log("Start recreating: ", this)
    super.defineAndRegisterId()
    super.buildSkeleton()
    super.buildChildsSkeleton()
    super.create()
  }
  // @overwrite
  create(){
    this.buildPropertiesRef()
    // step 1: geenrate If property, and configure to create (that build) or destry component!
    this.visible = new Property(this.convertedDefinition.meta.if, none, (v, _, prop)=>{ _info.log("set: ", v, _, prop); if (v !== prop._latestResolvedValue) { v ? this._create() : this._destroy() } }, pass, ()=>this.$this, (thisProp, deps)=>{

      let depsRemover = []
      
      _info.log("LEIF - Calculating deps")
      // deps connection logic
      deps.$parent_deps?.forEach(d=>{
        let depRemover = this.parent.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
        depRemover && depsRemover.push(depRemover)
      })

      deps.$scope_deps?.forEach(d=>{
        let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
        let depRemover = (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() ); // qui il ? server affinche si ci registri solo alle props (e non alle func etc!)
        depRemover && depsRemover.push(depRemover)
      })

      deps.$le_deps?.forEach(d=>{ // [le_id, property]
        let depRemover = this.$le[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
        depRemover && depsRemover.push(depRemover)
      })

      deps.$ctx_deps?.forEach(d=>{ // [le_id, property]
        let depRemover = this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
        depRemover && depsRemover.push(depRemover)
      })
      return depsRemover
    }, true)

    _info.log("Last if condition: ", this, this.convertedDefinition.meta.if)
    // try {
      this.visible.value && this._create()
    // }
    // catch {
    // }

  }

  _destroy(){
    super.destroy()
  }

  // real destroy
  destroy(){
    this.html_pointer_element_anchor.remove()
    this.visible.destroy(true)
    super.destroy()
  }

}

class SwitchConditionalComponent extends Component{
  visible = false
}


class IterableComponent extends Component{
  
  constructor(parent, definition, $le, $dbus, parentIterableView, iterableIndex, meta_config, meta_options){
    super(parent, definition, $le, $dbus)

    this.parentIterableView = parentIterableView
    this.iterableIndex = iterableIndex
    this.meta_config = meta_config
    this.meta_options = meta_options

    this.meta[this.meta_config.iterablePropertyIdentifier] = new Property(this.meta_config.value, none, none, none, ()=>this.$this, none, true)
    if (this.meta_config.define !== undefined){
      // define:{ index:"idx", first:"isFirst", last:"isLast", length:"len", iterable:"arr" }
      Object.entries(this.meta_config.define).forEach(([define_var, dev_var_name])=>{
        if (define_var in this.meta_config.define_helper){
          this.meta[dev_var_name] = new Property(this.meta_config.define_helper[define_var], none, none, none, ()=>this.$this, none, true)
        }
        // altre var custom!
        else {
          const custom_definition = dev_var_name
          this.meta[define_var] = new Property(custom_definition, none, ()=>{ throw Error("meta define variable cannot be setted") }, none, [()=>this.parent.$this, ()=>this.$this], none, true)
          // todo: on destroy
        }
        _info.log("I have some 'define' inside meta!", this.meta, define_var, dev_var_name, this.meta_config.define)
      })
    }
    let manualMarkSignalName = "_mark_"+this.meta_config.iterablePropertyIdentifier+"_as_changed"
    this.meta[manualMarkSignalName] = ()=>this.meta[this.meta_config.iterablePropertyIdentifier].markAsChanged()

    _info.log("before meta: ", this.$meta, this.parent.$meta, this.meta, this.parent.meta, this.parent)
    this.$meta = this.getMy$meta() // rebuild
    _info.log("after meta: ", this.$meta, this.parent.$meta, this.meta, this.parent.meta, this.parent)
  }

  // ridefinisco la crezione dell'html pointer, e definisco anche se devo autoeliminarmi..o ci pensa il parent
  // @overwrite, delegate html el construction to the Iterable View Hanlder (real parent)
  buildHtmlPointerElement(){

    this.parentIterableView.buildChildHtmlPointerElement(this, this.iterableIndex)

  }
  // la destroy funziona giĂ  bene, perchĂ¨ rimuoverĂ² me stesso (pointer)..!

}

class IterableViewComponent{
  iterableProperty
  iterablePropertyIdentifier

  parent
  $le
  $dbus

  oj_definition
  real_iterable_definition
  meta_def

  properties = {} // only for the "of" execution context, as child instead of parent!
  $this
  $parent

  childs = []

  html_pointer_element_anchor
  html_end_pointer_element_anchor

  // step 1: build
  constructor(parent, definition, $le, $dbus){
    this.parent = parent
    this.$le = $le
    this.$dbus = $dbus

    this.oj_definition = definition
    this.meta_def = ((definition instanceof UseComponentDeclaration ? definition.computedTemplate : definition)[getComponentType(definition)]).meta
    this.real_iterable_definition = (definition instanceof UseComponentDeclaration ? definition.cloneWithoutMeta() : cloneDefinitionWithoutMeta(definition))
    this.meta_options = {
      isNewScope: this.meta_def?.newScope,
      noThisInScope: this.meta_def?.noThisInScope,
      noMetaInScope: this.meta_def?.noMetaInScope,
      hasViewChilds: this.meta_def?.hasViewChilds
    }
  }

  get$ScopedPropsOwner(prop, search_depth=0, noMetaInScope=false){
    if(search_depth === 0){
      noMetaInScope = this.meta_options.noMetaInScope
    }

    if (this.parent === undefined || !(this.parent instanceof Component)){ // || this.parent instanceof IterableViewComponent)){
      return [this, true]
    }

    if (search_depth === 0 && this.meta_options.noThisInScope){ // salta il this e vai a parent..
      return this.parent.get$ScopedPropsOwner(prop, search_depth+1, noMetaInScope)
    }

    if (prop in this.properties){
      return [this, true]
    }
    else if (this.meta_options.isNewScope){
      throw Error("Properties cannot be found in this scope..blocked scope?")
    }
    else {
      return this.parent.get$ScopedPropsOwner(prop, search_depth+1, noMetaInScope)
    }

  }

  // generate the comment/anchor for the real conditional element (that will be create "after" the first or "before" the last "anchor")
  buildHtmlPointerElementAnchor(){
    
    this.html_pointer_element_anchor = document.createComment("le-for")
    this.html_end_pointer_element_anchor = document.createComment("le-for-end")

    if (this.isMyParentHtmlRoot){
      this.parent.appendChild(this.html_pointer_element_anchor)
      this.parent.appendChild(this.html_end_pointer_element_anchor)
    }
    else {
      this.parent.html_pointer_element.appendChild(this.html_pointer_element_anchor)
      this.parent.html_pointer_element.appendChild(this.html_end_pointer_element_anchor)
    }
  }

  buildChildHtmlPointerElement(child, childIndex){

    child.html_pointer_element = document.createElement(child.htmlElementType)

    this.html_end_pointer_element_anchor.before(child.html_pointer_element)
    // todo, child index to insert in right position
  }

  // step 2: build skeleton (only the anchors & exec context for 'of' evaluation!)
  buildSkeleton(){

    this.buildHtmlPointerElementAnchor()
    
    this.buildPropertiesRef()

  }

  // properties to execute "of" clausole as subel (always child point of view!)
  buildPropertiesRef(){

    // here super simplyfied execution context! only parent, le, and my parent ctx & meta is allowed..ob how can i refer to this if this does not exist already?

    // TODO: meta anche qui..

    this.properties.parent = this.parent?.$this?.this

    this.$parent = (this.parent instanceof Component) ? ComponentProxy(this.parent.properties) : undefined
    this.$scope = ComponentScopeProxy(this)
    this.$this = ComponentProxy({parent: this.$parent, le: this.$le.proxy, scope: this.$scope, ctx: this.parent.$ctx.proxy, meta: this.parent.$meta})
  }


  //@override, per utilizzare nella Factory this.parent come parent e non this. inoltre qui in realtĂ  parlo dei children come entitĂ  replicate, e non i child del template..devo passare una versione del template senza meta alla component factory! altrimenti errore..
  // in realtĂ  dovrebbe essere un "build child skeleton and create child"
  buildChildsSkeleton(){
    this._destroyChilds()

    // todo, algoritmo reale euristico, che confronta itmet per item (via this.iterableProperty.value._latestResolvedValue[idx] !== arrValue)
    this.childs = (this.iterableProperty.value?.map((arrValue, idx, arr)=>new IterableComponent(this.parent, this.real_iterable_definition, this.$le, this.$dbus, this, idx, {iterablePropertyIdentifier: this.iterablePropertyIdentifier, value: arrValue, define: this.meta_def.define, define_helper: {index: idx, first: idx === 0, last: idx === arr.length-1, length: arr.length, iterable: arr}}, this.meta_options)) || [] )

    // devo sicuramente fare una roba come per il conditional..un componente che estende component, perchĂ¨ devo per forza gestire meglio la parte di append all'html pointer..

    this.childs.forEach(child=>child.buildSkeleton())
    this.childs.forEach(child=>child.create())

  }

  _destroyChilds(){
    if (this.childs.length > 0){
      this.childs.map(c=>c.destroy())
      this.childs = []
    }
  }

  // real "create", wrapped in the conditional system
  _create(){
    _info.log("start recreating: ", this)
    this.buildChildsSkeleton()
  }

  // @overwrite
  create(){

    // step 1: generate Of clausole property, and configure to create (build) or destry component!
    this.iterablePropertyIdentifier = this.meta_def.forEach

    this.iterableProperty = new Property(
      this.meta_def.of, 
      none, 
      (v, _, prop)=>{ 
        _info.log("set iterable", v, _, prop); 
        if (this.meta_def.comparer !== undefined){
          if (this.meta_def.comparer(v, prop._latestResolvedValue)) { 
              this._create()
            }
        }
        else if (v !== prop._latestResolvedValue) { 
          this._create()
        } 
      }, 
      pass, 
      // aggancio gli autoaggiornamenti della property per far in modo che la set vada a buon fine senza una "set" reale e diretta
      ()=>this.$this, (thisProp, deps)=>{
        let depsRemover = []
        _info.log("calculating deps")
        // deps connection logic
        deps.$parent_deps?.forEach(d=>{
          let depRemover = this.parent.properties[d]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
          depRemover && depsRemover.push(depRemover)
        })

        deps.$scope_deps?.forEach(d=>{
          let [propsOwner, isPropertiesProp] = this.get$ScopedPropsOwner(d);
          let depRemover = (isPropertiesProp ? propsOwner.properties[d] : propsOwner.meta[d])?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() ); // qui il ? server affinche si ci registri solo alle props (e non alle func etc!)
          depRemover && depsRemover.push(depRemover)
        }) // supporting multiple deps, but only of first order..

        deps.$le_deps?.forEach(d=>{ // [le_id, property]
          let depRemover = this.$le[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
          depRemover && depsRemover.push(depRemover)
        })

        deps.$ctx_deps?.forEach(d=>{ // [le_id, property]
          let depRemover = this.$ctx[d[0]].properties[d[1]]?.addOnChangedHandler(thisProp, ()=>thisProp.markAsChanged() )
          depRemover && depsRemover.push(depRemover)
        })
        return depsRemover
      }, 
      true
    )

    _info.log("last of condition: ", this, this.meta_def.of)
    
    // try {
    this.iterableProperty.value.length > 0 && this._create()
    // }
    // catch {
    // }

  }
  destroy(){
    this._destroyChilds()

    this.html_pointer_element_anchor.remove()
    this.html_end_pointer_element_anchor.remove()

    this.iterableProperty.destroy(true)

  }

}


// export 
const Case = (clausole, el)=>{ 

  let componentType = getComponentType(definition)
    
  let {meta, ...oj_definition_no_meta} = definition[componentType]
  return {[componentType]: { meta: {if: clausole}, ...oj_definition_no_meta }}

}
// export 
/*
const x = { div: {
  "=>":[
    { h6: { text: "hello" }},

    ...Switch(
      Case( $=>$.parent.var1===0,
        { span: { text: "i'm var 1!!"}}
      ),
      Case( $=>$.parent.var1!==0,
        { span: { text: "i'm var 1 not 0!!"}}
      )
    )
  ]
}}*/
const Switch = (conditions)=>{
  return conditions
}



// // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // 
// DYNAMIC JS/CSS LOADING -- TESTING --
// TODO: TEST!!!! assolutamente temporaneo..importato da LE originale
const _init_LE_Loaded_Sentinel_ = ()=>{ if (window._Caged_LE_Loaded === undefined){ window._Caged_LE_Loaded = {} } }
/** 
 * Dynamic JS Loading
 * - When resolved the loaded script HTMLEL is returned, so you can remove the js from the page at any time with ".LE_removeScript()"
 * - alternatively you can remove using document.querySelector('[src="..CSS_URL.."]').LE_removeStyle()
 * NOTE: remotion does not have any effect without a "destructor" tht clean all vars etc in window and so on, because once a script is loaded it's keept in ram forever (also if .removed)
*/
// export 
const LE_LoadScript = (url, {do_microwait=undefined, attr={}, scriptDestructor=()=>{}, debug=false}={})=>{
    _init_LE_Loaded_Sentinel_()

    return new Promise(function(resolve, reject) {
        
        if (window._Caged_LE_Loaded[url] !== undefined){
            debug && _info.log("js already loaded!")
            if (do_microwait !== undefined){ setTimeout(() => { resolve(window._Caged_LE_Loaded[url]) }, do_microwait); }
            else{ resolve(window._Caged_LE_Loaded[url]) }
            return;
        }

        let script = document.createElement("script");
        
        script.onload = (e)=>{
            window._Caged_LE_Loaded[url] = script; 
            script.LE_removeScript = ()=>{window._Caged_LE_Loaded[url].remove(); scriptDestructor(); delete window._Caged_LE_Loaded[url] } 
            debug && _info.log("resolved!", e)
            if (do_microwait !== undefined){ setTimeout(() => { resolve(window._Caged_LE_Loaded[url]) }, do_microwait); }
            else{ resolve(window._Caged_LE_Loaded[url]) }
        };
        script.onerror = reject;
        
        script.setAttribute('src', url);
        Object.keys(attr).map(k=>script.setAttribute(k, attr));

        document.head.appendChild(script);
    });
}
/** 
 * Dynamic Css Loading
 * - When resolved the loaded css HTMLEL is returned, so you can remove the style from the page at any time with ".LE_removeStyle()"
 * - alternatively you can remove using document.querySelector('[href="..CSS_URL.."]').LE_removeStyle()
*/
// export 
const LE_LoadCss = (url, {do_microwait=undefined, attr={}, debug=false}={})=>{
    _init_LE_Loaded_Sentinel_()

    return new Promise(function(resolve, reject) { 
        
        if (window._Caged_LE_Loaded[url] !== undefined){
            _info.log("css already loaded!")
            if (do_microwait !== undefined){ setTimeout(() => { resolve(window._Caged_LE_Loaded[url]) }, do_microwait); }
            else{ resolve(window._Caged_LE_Loaded[url]) }
            return;
        }

        let s = document.createElement('link');
        
        s.setAttribute('rel', 'stylesheet');
        s.setAttribute('href', url);
        Object.keys(attr).map(k=>s.setAttribute(k, attr));

        s.onload = (e)=>{
            window._Caged_LE_Loaded[url] = s;
            debug && _info.log("resolved!", e)
            s.LE_removeStyle = ()=>{window._Caged_LE_Loaded[url].remove(); delete window._Caged_LE_Loaded[url] } 
            if (do_microwait !== undefined){ setTimeout(() => { resolve(window._Caged_LE_Loaded[url]) }, do_microwait); }
            else{ resolve(window._Caged_LE_Loaded[url]) }
        };
        s.onerror = reject;
            
        document.head.appendChild(s);
    })
}
// export 
const LE_InitWebApp = (appDef)=>{ document.addEventListener("DOMContentLoaded", appDef ) }
// // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // 

// export
/**
 * @returns {($)=>any}
 * */
const smartFunc = (code, funcCall=false, ...oterArgs)=>{
  if (!funcCall) { code = code[0] }
  code=code.replaceAll("@m.", "$.meta.").replaceAll("@s.", "$.scope.").replaceAll("@p.", "$.parent.").replaceAll("@t.", "$.this.").replaceAll("@l.", "$.le.").replaceAll("@c.", "$.ctx.").replaceAll("@d.", "$.dbus.").replaceAll("@", "$.scope.")
  code=code.replaceAll(":m:", "$.meta.").replaceAll(":s:", "$.scope.").replaceAll(":p:", "$.parent.").replaceAll(":t:", "$.this.").replaceAll(":l:", "$.le.").replaceAll(":c:", "$.ctx.").replaceAll(":d:", "$.dbus.").replaceAll(":::", "$.meta.").replaceAll("::", "$.scope.")
  if (code.includes("return") || code.startsWith("{")){
    return new Function("$", ...oterArgs, code)
  } else {
    return new Function("$", ...oterArgs, "return "+code)
  }
}

const smartFuncWithCustomArgs = (...oterArgs)=>{
  return (code, funcCall=false)=>smartFunc(code, funcCall, ...oterArgs)
}

// // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // 


/*
class TodoModelApiMock extends LE_BackendApiMock{
  constructor(apiSpeed=100){
    super(apiSpeed)
    this.model = { todos: [ { id: 0, todo:"hi", done: false } ] }
    this.services = {
      "/num-todos": ()=>{return {len: this.mode.todos.length} }
    }
  }
  getTodo(args){
    let {id} = this.request(args)
    return this.response(this.model.todos.find(t=>t.id === id))
  }
}
let todoModelApi = new TodoModelMockApi()
setTimeout(async ()=>{
  console.log("calling..")
  let res = await todoModelApi.getTodo({id: 0})
  console.log(typeof res, res)
}, 10)
*/
// export 
class LE_BackendApiMock{ // base class for backend api mock -> purpose is to have a "model" and some api call (wrapped), with some jsonization, to avoid "refernece" effect
  
  constructor(apiSpeed=100){
    this.services = {}
    this.apiSpeed = apiSpeed
  }
  
  response(value){
    return new Promise((resolve, reject)=>{setTimeout(()=>resolve(JSON.parse(JSON.stringify(value))), this.apiSpeed) })
  }
  failResponse(error){
    return new Promise((resolve, reject)=>{setTimeout(()=>reject(JSON.parse(JSON.stringify(error))), this.apiSpeed) })
  }
  request(value){
    if (value !== undefined)
      return JSON.parse(JSON.stringify(value))
    return undefined
  }

  // only json..
  get(route, params){ return this.response(this.services[route](this.request(params))) }
  post(route, data){ return this.response(this.services[route](this.request(data))) }
  put(route, data){ return this.response(this.services[route](this.request(data))) }
}


export { pass, none, smart, smartFunc as f, smartFuncWithCustomArgs as fArgs, Use, Extended, Placeholder, Bind, Alias, SmartAlias, Switch, Case, RenderApp, toInlineStyle, LE_LoadScript, LE_LoadCss, LE_InitWebApp, LE_BackendApiMock }
// full import: {pass, none, smart, Use, Bind, RenderApp, LE_LoadScript, LE_LoadCss, LE_InitWebApp}
