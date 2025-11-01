import React from 'react'

// Components
import Header from '../Header/Header'
import Banner from './components/banner/Banner'
import Topfive from './components/topfive/Topfive'
import Seasons from './components/seasons/Seasons'
import Footer from '../footer/Footer'

const Homepage = () => {
  return (
    <div>
      <Header />
      <Banner/>
      <Seasons/>
      <Topfive/>
      <Footer/>
    </div>
  )
}

export default Homepage
